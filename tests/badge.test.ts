import { describe, expect, it, vi } from "vitest";
import { AnalysisError } from "@/lib/analysis/analyze-repository";
import { BusyError, getCachedReport, type HandlerDeps } from "@/lib/api/analyze-handler";
import { ConcurrencyGate, SlidingWindowLimiter, TtlCache } from "@/lib/api/rate-limit";
import { handleBadgeRequest } from "@/lib/badge/badge-handler";
import { escapeXml, renderBadge, scoreBadgeColor, textWidth } from "@/lib/badge/render-badge";
import { GitHubClient, GitHubError } from "@/lib/github/client";
import type { Report } from "@/lib/reports/schema";
import { fakeGitHub } from "./fake-github";
import { HEALTHY_PROJECT, report } from "./helpers";

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

const limiter = () => new SlidingWindowLimiter(100, 60_000);
const headers = () => new Headers({ "x-forwarded-for": "203.0.113.7" });

describe("renderBadge", () => {
  it("produces a well-formed SVG with label and message", () => {
    const svg = renderBadge({ label: "RepoPilot", message: "93 · A", color: "#1f883d" });
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain('aria-label="RepoPilot: 93 · A"');
    expect(svg).toContain('fill="#1f883d"');
    expect(svg.trim().endsWith("</svg>")).toBe(true);
  });

  it("escapes XML in text and rejects non-hex colors", () => {
    const svg = renderBadge({ label: "<script>", message: `a"&'b`, color: "red;onload=x" });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("a&quot;&amp;&apos;b");
    expect(svg).toContain('fill="#9f9f9f"');
    expect(escapeXml("<>&")).toBe("&lt;&gt;&amp;");
  });

  it("widens with longer text", () => {
    expect(textWidth("not found")).toBeGreaterThan(textWidth("93"));
    expect(textWidth("WWW")).toBeGreaterThan(textWidth("iii"));
  });

  it("maps score bands to colors", () => {
    expect([95, 80, 65, 45, 10].map(scoreBadgeColor)).toEqual(["#1f883d", "#2da44e", "#9a6700", "#bc4c00", "#cf222e"]);
  });
});

describe("handleBadgeRequest", () => {
  it("returns the real score with long CDN caching", async () => {
    const res = await handleBadgeRequest("acme", "widget", headers(), deps(), limiter());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(res.headers.get("cache-control")).toContain("s-maxage=21600");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await res.text()).toContain("100 · A");
  });

  it("accepts a .svg suffix", async () => {
    expect(await (await handleBadgeRequest("acme", "widget.svg", headers(), deps(), limiter())).text()).toContain("100 · A");
  });

  it("returns an SVG (never a broken image) for invalid input and failures", async () => {
    const cases: [string, string, Partial<HandlerDeps>, string][] = [
      ["settings", "x", {}, "invalid repository"],
      ["acme", "..", {}, "invalid repository"],
      ["acme", "missing", { analyze: async () => Promise.reject(new GitHubError("not_found", "x")) }, "not found"],
      ["acme", "empty", { analyze: async () => Promise.reject(new AnalysisError("empty_repository", "x")) }, "empty repository"],
      ["acme", "slow", { analyze: async () => Promise.reject(new GitHubError("timeout", "x")) }, "unavailable"],
      ["acme", "busy", { gate: new ConcurrencyGate(0) }, "busy, retry"],
    ];
    for (const [owner, repo, override, message] of cases) {
      const res = await handleBadgeRequest(owner, repo, headers(), deps(override), limiter());
      expect(res.status).toBe(200);
      expect([repo, await res.text()]).toEqual([repo, expect.stringContaining(message)]);
    }
  });

  it("does not leak internal error messages", async () => {
    const res = await handleBadgeRequest(
      "acme",
      "boom",
      headers(),
      deps({ analyze: async () => Promise.reject(new Error("secret db password")) }),
      limiter(),
    );
    expect(await res.text()).not.toContain("secret");
  });

  it("rate-limits per client with a short cache", async () => {
    const l = new SlidingWindowLimiter(1, 60_000);
    const d = deps();
    await handleBadgeRequest("acme", "widget", headers(), d, l);
    const limited = await handleBadgeRequest("acme", "widget", headers(), d, l);
    expect(await limited.text()).toContain("rate limited");
    expect(limited.headers.get("cache-control")).toContain("max-age=60");
  });

  it("reuses the shared cache instead of re-scanning", async () => {
    const analyze = vi.fn(async () => report(HEALTHY_PROJECT));
    const d = deps({ analyze });
    await handleBadgeRequest("acme", "widget", headers(), d, limiter());
    await handleBadgeRequest("ACME", "Widget", headers(), d, limiter());
    await getCachedReport("acme", "widget", d);
    expect(analyze).toHaveBeenCalledTimes(1);
  });
});

describe("getCachedReport", () => {
  it("throws BusyError when the concurrency gate is full and releases slots after errors", async () => {
    await expect(getCachedReport("a", "b", deps({ gate: new ConcurrencyGate(0) }))).rejects.toBeInstanceOf(BusyError);
    const gate = new ConcurrencyGate(1);
    await expect(getCachedReport("a", "b", deps({ gate, analyze: async () => Promise.reject(new Error("x")) }))).rejects.toThrow();
    expect(gate.inUse).toBe(0);
  });
});
