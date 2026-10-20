import { z } from "zod";

/**
 * Minimal, bounded GitHub client.
 *
 * Security properties:
 *  - Only two fixed origins are ever contacted (API_ORIGIN and RAW_ORIGIN). URLs are built
 *    from validated owner/repo names and encoded path segments, never from user-supplied URLs.
 *  - Redirects are followed manually and only when they stay on an allowed origin.
 *  - Every request has a timeout and every response body is read with a byte cap.
 *  - Response JSON is validated with Zod before use.
 */

export const API_ORIGIN = "https://api.github.com";
export const RAW_ORIGIN = "https://raw.githubusercontent.com";
const ALLOWED_ORIGINS = new Set([API_ORIGIN, RAW_ORIGIN]);
const MAX_REDIRECTS = 3;

export type GitHubErrorCode =
  | "not_found"
  | "rate_limited"
  | "forbidden"
  | "empty_repository"
  | "timeout"
  | "too_large"
  | "invalid_response"
  | "upstream_error";

export class GitHubError extends Error {
  constructor(
    public readonly code: GitHubErrorCode,
    message: string,
    public readonly status?: number,
    /** Unix epoch seconds when the rate limit resets, when known. */
    public readonly resetAt?: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type GitHubClientOptions = {
  token?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Max bytes for JSON API responses (the recursive tree can be large). */
  maxJsonBytes?: number;
  userAgent?: string;
};

// ---- Response schemas (only the fields we use) ----

export const RepoMetadataSchema = z.object({
  name: z.string(),
  full_name: z.string(),
  owner: z.object({ login: z.string() }),
  private: z.boolean(),
  html_url: z.string(),
  description: z.string().nullable(),
  fork: z.boolean(),
  archived: z.boolean().default(false),
  default_branch: z.string(),
  stargazers_count: z.number().int().nonnegative(),
  forks_count: z.number().int().nonnegative(),
  open_issues_count: z.number().int().nonnegative(),
  size: z.number().nonnegative(),
  pushed_at: z.string().nullable().optional(),
  license: z.object({ spdx_id: z.string().nullable() }).nullable().optional(),
  topics: z.array(z.string()).optional(),
});
export type RepoMetadata = z.infer<typeof RepoMetadataSchema>;

const BranchSchema = z.object({
  name: z.string(),
  commit: z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/) }),
});

export const TreeEntrySchema = z.object({
  path: z.string(),
  type: z.enum(["blob", "tree", "commit"]),
  size: z.number().int().nonnegative().optional(),
  mode: z.string().optional(),
});
export type TreeEntry = z.infer<typeof TreeEntrySchema>;

const TreeSchema = z.object({
  sha: z.string(),
  tree: z.array(TreeEntrySchema),
  truncated: z.boolean(),
});
export type Tree = z.infer<typeof TreeSchema>;

const LanguagesSchema = z.record(z.string(), z.number().nonnegative());

// ---- Helpers ----

async function readBodyCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new GitHubError("too_large", `Response exceeds ${maxBytes} bytes.`);
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new GitHubError("too_large", `Response exceeds ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Encodes each path segment so repository paths can never alter the URL structure. */
export function encodeRepoPath(path: string): string {
  const segments = path.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) {
    throw new GitHubError("invalid_response", "Unsafe repository path.");
  }
  return segments.map(encodeURIComponent).join("/");
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

export class GitHubClient {
  private readonly token?: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxJsonBytes: number;
  private readonly userAgent: string;
  /** Number of requests sent to the GitHub REST API (rate-limited) by this client. */
  apiRequests = 0;
  /** Most recent x-ratelimit-remaining value observed, when available. */
  rateLimitRemaining: number | null = null;

  constructor(options: GitHubClientOptions = {}) {
    this.token = options.token || undefined;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxJsonBytes = options.maxJsonBytes ?? 12 * 1024 * 1024;
    this.userAgent = options.userAgent ?? "RepoPilot (+https://github.com)";
  }

  get authenticated(): boolean {
    return Boolean(this.token);
  }

  private async request(url: string, init: { accept: string; useToken: boolean; signal?: AbortSignal }): Promise<Response> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const parsed = new URL(current);
      if (!ALLOWED_ORIGINS.has(parsed.origin)) {
        throw new GitHubError("invalid_response", "Refusing to contact a non-GitHub origin.");
      }
      const headers: Record<string, string> = {
        Accept: init.accept,
        "User-Agent": this.userAgent,
      };
      if (parsed.origin === API_ORIGIN) {
        headers["X-GitHub-Api-Version"] = "2022-11-28";
        // The token is only ever sent to the API origin.
        if (init.useToken && this.token) headers.Authorization = `Bearer ${this.token}`;
        this.apiRequests++;
      }
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const signal = init.signal ? AbortSignal.any([timeout, init.signal]) : timeout;
      let response: Response;
      try {
        response = await this.fetchImpl(current, { headers, redirect: "manual", signal, cache: "no-store" });
      } catch (error) {
        if (isTimeout(error)) throw new GitHubError("timeout", "GitHub did not respond in time.");
        throw new GitHubError("upstream_error", "Could not reach GitHub.");
      }
      if (parsed.origin === API_ORIGIN) {
        const remaining = response.headers.get("x-ratelimit-remaining");
        if (remaining !== null && Number.isFinite(Number(remaining))) this.rateLimitRemaining = Number(remaining);
      }
      if ([301, 302, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => {});
        if (!location) throw new GitHubError("invalid_response", "Redirect without a location.");
        current = new URL(location, current).toString();
        continue;
      }
      return response;
    }
    throw new GitHubError("invalid_response", "Too many redirects.");
  }

  private async throwForStatus(response: Response, context: string): Promise<never> {
    const status = response.status;
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    const resetAt = Number.isFinite(reset) && reset > 0 ? reset : undefined;
    let message = "";
    try {
      const body = new TextDecoder().decode(await readBodyCapped(response, 64 * 1024));
      const parsed = z.object({ message: z.string() }).safeParse(JSON.parse(body));
      if (parsed.success) message = parsed.data.message;
    } catch {
      // ignore unreadable error bodies
    }
    if (status === 429 || (status === 403 && (remaining === "0" || /rate limit/i.test(message)))) {
      throw new GitHubError("rate_limited", "GitHub API rate limit reached.", status, resetAt);
    }
    if (status === 404) throw new GitHubError("not_found", `${context} was not found or is not public.`, status);
    if (status === 409 && /empty/i.test(message)) {
      throw new GitHubError("empty_repository", "This repository is empty.", status);
    }
    if (status === 401 || status === 403 || status === 451) {
      throw new GitHubError("forbidden", `GitHub denied access to ${context.toLowerCase()}.`, status);
    }
    throw new GitHubError("upstream_error", `GitHub returned an unexpected status (${status}).`, status);
  }

  private async getJson<T>(path: string, schema: z.ZodType<T>, context: string, signal?: AbortSignal): Promise<T> {
    const response = await this.request(`${API_ORIGIN}${path}`, {
      accept: "application/vnd.github+json",
      useToken: true,
      signal,
    });
    if (!response.ok) await this.throwForStatus(response, context);
    const bytes = await readBodyCapped(response, this.maxJsonBytes);
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new GitHubError("invalid_response", `GitHub returned malformed JSON for ${context.toLowerCase()}.`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new GitHubError("invalid_response", `GitHub returned an unexpected shape for ${context.toLowerCase()}.`);
    }
    return parsed.data;
  }

  private repoBase(owner: string, repo: string): string {
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  }

  getRepository(owner: string, repo: string, signal?: AbortSignal): Promise<RepoMetadata> {
    return this.getJson(this.repoBase(owner, repo), RepoMetadataSchema, "Repository", signal);
  }

  async getBranchHead(owner: string, repo: string, branch: string, signal?: AbortSignal): Promise<string> {
    const data = await this.getJson(
      `${this.repoBase(owner, repo)}/branches/${encodeURIComponent(branch)}`,
      BranchSchema,
      "Default branch",
      signal,
    );
    return data.commit.sha;
  }

  getTree(owner: string, repo: string, sha: string, signal?: AbortSignal): Promise<Tree> {
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new GitHubError("invalid_response", "Invalid commit SHA.");
    return this.getJson(`${this.repoBase(owner, repo)}/git/trees/${sha}?recursive=1`, TreeSchema, "Repository tree", signal);
  }

  getLanguages(owner: string, repo: string, signal?: AbortSignal): Promise<Record<string, number>> {
    return this.getJson(`${this.repoBase(owner, repo)}/languages`, LanguagesSchema, "Language statistics", signal);
  }

  /**
   * Fetches a file's raw contents at an exact commit, capped at maxBytes.
   * Returns null for binary content (NUL byte in the first 8 KB).
   */
  async getRawFile(
    owner: string,
    repo: string,
    sha: string,
    path: string,
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new GitHubError("invalid_response", "Invalid commit SHA.");
    const url = `${RAW_ORIGIN}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${sha}/${encodeRepoPath(path)}`;
    const response = await this.request(url, { accept: "text/plain, */*", useToken: false, signal });
    if (!response.ok) await this.throwForStatus(response, "File");
    const bytes = await readBodyCapped(response, maxBytes);
    const head = bytes.subarray(0, 8192);
    if (head.includes(0)) return null;
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}
