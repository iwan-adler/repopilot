import { describe, expect, it, vi } from "vitest";
import { handleAnalyzeRequest, mapError, type HandlerDeps } from "@/lib/api/analyze-handler";
import { clientKey, ConcurrencyGate, SlidingWindowLimiter, TtlCache } from "@/lib/api/rate-limit";
import { AnalysisError } from "@/lib/analysis/analyze-repository";
import { GitHubClient, GitHubError } from "@/lib/github/client";
import type { Report } from "@/lib/reports/schema";
import { fakeGitHub } from "./fake-github";
import { HEALTHY_PROJECT } from "./helpers";

function deps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  const files: Record<string, string> = {};
  for (const [k, v] of Object.entries(HEALTHY_PROJECT)) files[k] = typeof v === "string" ? v : "x";
  return {
    createClient: () => new GitHubClient({ fetch: fakeGitHub({ files }).fetch }),
    limiter: new SlidingWindowLimiter(100, 60_000),
    gate: new ConcurrencyGate(4),
    cache: new TtlCache<Report>(60_000, 10),
    ...overrides,
  };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.5", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/analyze handler", () => {
  it("returns a report for a valid URL", async () => {
    const res = await handleAnalyzeRequest(post({ url: "https://github.com/acme/widget" }), deps());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cached).toBe(false);
    expect(body.report.repository.fullName).toBe("acme/widget");
  });

  it("validates content type, JSON, shape, size and URL", async () => {
    const d = deps();
    expect((await handleAnalyzeRequest(post({ url: "x" }, { "content-type": "text/plain" }), d)).status).toBe(415);
    expect((await handleAnalyzeRequest(post("{nope"), d)).status).toBe(400);
    expect((await handleAnalyzeRequest(post({}), d)).status).toBe(400);
    expect((await handleAnalyzeRequest(post({ url: "https://github.com/a/b", extra: 1 }), d)).status).toBe(400);
    expect((await handleAnalyzeRequest(post({ url: 42 }), d)).status).toBe(400);
    expect((await handleAnalyzeRequest(post({ url: "x".repeat(5000) }), d)).status).toBe(413);
    const bad = await handleAnalyzeRequest(post({ url: "https://gitlab.com/a/b" }), d);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("invalid_url");
  });

  it("rate-limits per client and sets Retry-After", async () => {
    const d = deps({ limiter: new SlidingWindowLimiter(1, 60_000) });
    expect((await handleAnalyzeRequest(post({ url: "acme/widget" }), d)).status).toBe(200);
    const limited = await handleAnalyzeRequest(post({ url: "acme/widget" }), d);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    // A different client is unaffected.
    expect((await handleAnalyzeRequest(post({ url: "acme/widget" }, { "x-forwarded-for": "198.51.100.1" }), d)).status).toBe(200);
  });

  it("serves repeated scans from the cache without new GitHub calls", async () => {
    const createClient = vi.fn(deps().createClient);
    const d = deps({ createClient });
    await handleAnalyzeRequest(post({ url: "acme/widget" }), d);
    const second = await handleAnalyzeRequest(post({ url: "https://github.com/ACME/Widget" }), d);
    expect((await second.json()).cached).toBe(true);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("returns 503 busy when the concurrency gate is full", async () => {
    const gate = new ConcurrencyGate(0);
    const res = await handleAnalyzeRequest(post({ url: "acme/widget" }), deps({ gate }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("busy");
  });

  it("releases the concurrency slot after errors", async () => {
    const gate = new ConcurrencyGate(1);
    const analyze = vi.fn(async () => {
      throw new GitHubError("not_found", "nope");
    });
    const res = await handleAnalyzeRequest(post({ url: "acme/widget" }), deps({ gate, analyze }));
    expect(res.status).toBe(404);
    expect(gate.inUse).toBe(0);
  });

  it("streams NDJSON progress and the final report", async () => {
    const res = await handleAnalyzeRequest(post({ url: "acme/widget" }, { accept: "application/x-ndjson" }), deps());
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const lines = (await res.text())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines.some((l) => l.type === "progress")).toBe(true);
    expect(lines.at(-1).type).toBe("result");
    expect(lines.at(-1).report.id).toBe("acme/widget@0123456789ab");
  });

  it("streams errors as a final error event", async () => {
    const analyze = vi.fn(async () => {
      throw new AnalysisError("empty_repository", "empty");
    });
    const res = await handleAnalyzeRequest(post({ url: "acme/widget" }, { accept: "application/x-ndjson" }), deps({ analyze }));
    const last = JSON.parse((await res.text()).trim().split("\n").at(-1)!);
    expect(last).toMatchObject({ type: "error", status: 422, error: { code: "empty_repository" } });
  });

  it("logs only metadata, never report contents", async () => {
    const log = vi.fn();
    await handleAnalyzeRequest(post({ url: "acme/widget" }), deps({ log }));
    expect(log).toHaveBeenCalledTimes(1);
    const entry = log.mock.calls[0][0];
    expect(Object.keys(entry).sort()).toEqual(["cached", "ms", "outcome", "repo"]);
  });
});

describe("mapError", () => {
  it.each([
    [new GitHubError("not_found", "x"), 404, "not_found"],
    [new GitHubError("forbidden", "x"), 403, "private_repository"],
    [new GitHubError("rate_limited", "x", 403, Math.floor(Date.now() / 1000) + 120), 503, "github_rate_limited"],
    [new GitHubError("timeout", "x"), 504, "timeout"],
    [new GitHubError("too_large", "x"), 413, "too_large"],
    [new GitHubError("invalid_response", "x"), 502, "upstream_error"],
    [new AnalysisError("private_repository", "x"), 403, "private_repository"],
    [new AnalysisError("empty_repository", "x"), 422, "empty_repository"],
    [new Error("boom"), 500, "internal_error"],
  ])("maps %s", (err, status, code) => {
    const m = mapError(err);
    expect(m.status).toBe(status);
    expect(m.error.code).toBe(code);
  });

  it("does not leak internal error messages", () => {
    expect(mapError(new Error("secret internal detail")).error.message).not.toContain("secret");
  });

  it("computes retry time for GitHub rate limits", () => {
    const m = mapError(new GitHubError("rate_limited", "x", 403, Math.floor(Date.now() / 1000) + 300));
    expect(m.error.retryAfterSeconds).toBeGreaterThan(250);
  });
});

describe("rate-limit primitives", () => {
  it("SlidingWindowLimiter allows `limit` hits per window", () => {
    const l = new SlidingWindowLimiter(2, 1000);
    expect(l.check("a", 0).allowed).toBe(true);
    expect(l.check("a", 10).allowed).toBe(true);
    const third = l.check("a", 20);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBe(1);
    expect(l.check("a", 1001).allowed).toBe(true);
  });

  it("SlidingWindowLimiter bounds memory", () => {
    const l = new SlidingWindowLimiter(1, 1000, 3);
    for (const k of ["a", "b", "c", "d"]) l.check(k, 0);
    // "a" was evicted, so it is allowed again.
    expect(l.check("a", 1).allowed).toBe(true);
  });

  it("TtlCache expires and evicts", () => {
    const c = new TtlCache<number>(100, 2);
    c.set("a", 1, 0);
    expect(c.get("a", 50)).toBe(1);
    expect(c.get("a", 100)).toBeUndefined();
    c.set("x", 1, 0);
    c.set("y", 2, 0);
    c.set("z", 3, 0);
    expect(c.get("x", 1)).toBeUndefined();
    expect(c.get("z", 1)).toBe(3);
  });

  it("ConcurrencyGate release is idempotent", () => {
    const g = new ConcurrencyGate(1);
    const r = g.tryAcquire()!;
    expect(g.tryAcquire()).toBeNull();
    r();
    r();
    expect(g.inUse).toBe(0);
  });

  it("clientKey uses the first forwarded address", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientKey(new Headers({ "x-real-ip": "3.3.3.3" }))).toBe("3.3.3.3");
    expect(clientKey(new Headers())).toBe("unknown");
  });
});
