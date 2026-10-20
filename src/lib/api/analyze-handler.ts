import { AnalysisError, analyzeRepository, type ProgressEvent } from "@/lib/analysis/analyze-repository";
import { GitHubClient, GitHubError } from "@/lib/github/client";
import { parseGitHubRepoUrl } from "@/lib/github/parse-url";
import type { Report } from "@/lib/reports/schema";
import { AnalyzeRequestSchema, MAX_REQUEST_BODY_BYTES } from "@/lib/validation/repository";
import { clientKey, ConcurrencyGate, SlidingWindowLimiter, TtlCache } from "./rate-limit";

export type ApiErrorCode =
  | "invalid_request"
  | "invalid_url"
  | "not_found"
  | "private_repository"
  | "empty_repository"
  | "rate_limited"
  | "github_rate_limited"
  | "busy"
  | "too_large"
  | "timeout"
  | "upstream_error"
  | "internal_error";

export type ApiError = { code: ApiErrorCode; message: string; retryAfterSeconds?: number };

/** One NDJSON line of the streaming response. */
export type StreamEvent =
  | { type: "progress"; event: ProgressEvent }
  | { type: "result"; report: Report; cached: boolean }
  | { type: "error"; error: ApiError; status: number };

export type HandlerDeps = {
  createClient: () => GitHubClient;
  limiter: SlidingWindowLimiter;
  gate: ConcurrencyGate;
  cache: TtlCache<Report>;
  analyze?: typeof analyzeRepository;
  log?: (entry: Record<string, unknown>) => void;
};

export function createDefaultDeps(): HandlerDeps {
  return {
    // The token (optional) stays server-side and is only sent to api.github.com.
    createClient: () => new GitHubClient({ token: process.env.GITHUB_TOKEN, userAgent: "RepoPilot-Analyzer" }),
    limiter: new SlidingWindowLimiter(Number(process.env.RATE_LIMIT_PER_10_MIN) || 10, 10 * 60 * 1000),
    gate: new ConcurrencyGate(4),
    cache: new TtlCache<Report>(10 * 60 * 1000, 100),
    // Logs contain only repository names, outcome codes and timings — never file contents.
    log: (entry) => console.info(JSON.stringify({ scope: "analyze", ...entry })),
  };
}

function jsonError(error: ApiError, status: number): Response {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (error.retryAfterSeconds) headers["Retry-After"] = String(error.retryAfterSeconds);
  return Response.json({ error }, { status, headers });
}

export function mapError(err: unknown): { error: ApiError; status: number } {
  if (err instanceof AnalysisError) {
    return err.code === "private_repository"
      ? { status: 403, error: { code: "private_repository", message: err.message } }
      : { status: 422, error: { code: "empty_repository", message: err.message } };
  }
  if (err instanceof GitHubError) {
    switch (err.code) {
      case "not_found":
        return {
          status: 404,
          error: {
            code: "not_found",
            message: "Repository not found. Check the URL, and note that RepoPilot can only analyze public repositories.",
          },
        };
      case "forbidden":
        return {
          status: 403,
          error: {
            code: "private_repository",
            message: "GitHub denied access to this repository. It may be private, disabled, or blocked.",
          },
        };
      case "empty_repository":
        return {
          status: 422,
          error: { code: "empty_repository", message: "This repository is empty, so there is nothing to analyze yet." },
        };
      case "rate_limited": {
        const retry = err.resetAt ? Math.max(1, err.resetAt - Math.floor(Date.now() / 1000)) : 60;
        return {
          status: 503,
          error: {
            code: "github_rate_limited",
            message: `RepoPilot has reached GitHub's API rate limit. Please try again in about ${Math.ceil(retry / 60)} minute(s).`,
            retryAfterSeconds: retry,
          },
        };
      }
      case "timeout":
        return {
          status: 504,
          error: { code: "timeout", message: "The analysis took too long. GitHub may be slow right now — please try again." },
        };
      case "too_large":
        return { status: 413, error: { code: "too_large", message: err.message || "This repository is too large to analyze." } };
      default:
        return { status: 502, error: { code: "upstream_error", message: "GitHub returned an unexpected response. Please try again." } };
    }
  }
  return { status: 500, error: { code: "internal_error", message: "Something went wrong while analyzing this repository." } };
}

async function readBodyCapped(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function handleAnalyzeRequest(request: Request, deps: HandlerDeps): Promise<Response> {
  const started = Date.now();
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return jsonError({ code: "invalid_request", message: 'Send a JSON body: {"url": "https://github.com/owner/repo"}.' }, 415);
  }
  const raw = await readBodyCapped(request, MAX_REQUEST_BODY_BYTES);
  if (raw === null) return jsonError({ code: "invalid_request", message: "Request body is too large." }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError({ code: "invalid_request", message: "Request body is not valid JSON." }, 400);
  }
  const validated = AnalyzeRequestSchema.safeParse(body);
  if (!validated.success) {
    return jsonError({ code: "invalid_request", message: validated.error.issues[0]?.message ?? "Invalid request." }, 400);
  }
  const parsed = parseGitHubRepoUrl(validated.data.url);
  if (!parsed.ok) return jsonError({ code: "invalid_url", message: parsed.error }, 400);
  const { owner, repo } = parsed.value;
  const cacheKey = `${owner}/${repo}`.toLowerCase();
  const wantsStream = (request.headers.get("accept") ?? "").includes("application/x-ndjson");

  const limit = deps.limiter.check(clientKey(request.headers));
  if (!limit.allowed) {
    return jsonError(
      {
        code: "rate_limited",
        message: `Too many analyses from your network. Try again in ${limit.retryAfterSeconds} seconds.`,
        retryAfterSeconds: limit.retryAfterSeconds,
      },
      429,
    );
  }

  const cached = deps.cache.get(cacheKey);
  if (cached && !wantsStream) return Response.json({ report: cached, cached: true }, { headers: { "Cache-Control": "no-store" } });

  const release = cached ? () => {} : deps.gate.tryAcquire();
  if (!release) {
    return jsonError(
      { code: "busy", message: "RepoPilot is handling several analyses right now. Please retry in a few seconds.", retryAfterSeconds: 5 },
      503,
    );
  }

  const analyze = deps.analyze ?? analyzeRepository;
  const run = async (onProgress?: (e: ProgressEvent) => void): Promise<{ report: Report; cached: boolean }> => {
    if (cached) return { report: cached, cached: true };
    const report = await analyze(owner, repo, { client: deps.createClient(), onProgress, signal: request.signal });
    deps.cache.set(cacheKey, report);
    return { report, cached: false };
  };
  const logOutcome = (outcome: string, extra: Record<string, unknown> = {}) =>
    deps.log?.({ repo: cacheKey, outcome, ms: Date.now() - started, ...extra });

  if (!wantsStream) {
    try {
      const result = await run();
      logOutcome("ok", { cached: result.cached });
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      const mapped = mapError(err);
      logOutcome(mapped.error.code);
      return jsonError(mapped.error, mapped.status);
    } finally {
      release();
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          // client disconnected
        }
      };
      try {
        const result = await run((event) => send({ type: "progress", event }));
        send({ type: "result", ...result });
        logOutcome("ok", { cached: result.cached });
      } catch (err) {
        const mapped = mapError(err);
        send({ type: "error", ...mapped });
        logOutcome(mapped.error.code);
      } finally {
        release();
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
