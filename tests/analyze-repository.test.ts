import { describe, expect, it } from "vitest";
import { AnalysisError, analyzeRepository, DEFAULT_LIMITS, selectFiles } from "@/lib/analysis/analyze-repository";
import { GitHubClient, GitHubError } from "@/lib/github/client";
import { ReportSchema } from "@/lib/reports/schema";
import { fakeGitHub, json } from "./fake-github";
import { HEALTHY_PROJECT, report } from "./helpers";

function textFiles(spec: Record<string, string | number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(spec)) out[k] = typeof v === "number" ? "x".repeat(Math.min(v, 2000)) : v;
  return out;
}

describe("analyzeRepository (end to end with a fake GitHub)", () => {
  it("produces a valid report for a healthy project", async () => {
    const gh = fakeGitHub({ files: textFiles(HEALTHY_PROJECT) });
    const events: string[] = [];
    const r = await analyzeRepository("acme", "widget", {
      client: new GitHubClient({ fetch: gh.fetch }),
      onProgress: (e) => events.push(e.stage),
      now: () => new Date("2026-10-20T00:00:00Z"),
    });
    expect(ReportSchema.safeParse(r).success).toBe(true);
    expect(r.id).toBe("acme/widget@0123456789ab");
    expect(r.repository.license).toBe("MIT");
    expect(r.stack.primaryLanguage).toBe("TypeScript");
    expect(r.score.overall).toBe(100);
    expect(r.findings).toEqual([]);
    expect(r.budget.apiRequests).toBe(4);
    expect(r.budget.filesFetched).toBeGreaterThan(5);
    expect(events).toEqual(expect.arrayContaining(["metadata", "tree", "files", "analysis"]));
    // Only GitHub origins were contacted.
    expect(gh.calls.every((c) => /^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//.test(c.url))).toBe(true);
  });

  it("never includes a detected secret or raw file contents in the report", async () => {
    const token = "ghp" + "_" + "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5";
    const files = { "README.md": "# hi", "src/config.js": `module.exports = { token: "${token}" };\n// UNIQUE_SOURCE_MARKER` };
    const r = await analyzeRepository("acme", "widget", { client: new GitHubClient({ fetch: fakeGitHub({ files }).fetch }) });
    const serialized = JSON.stringify(r);
    expect(r.findings.some((f) => f.ruleId === "SEC001" && f.severity === "critical")).toBe(true);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain("UNIQUE_SOURCE_MARKER");
  });

  it("rejects private repositories even if visible to the token", async () => {
    const gh = fakeGitHub({ private: true, files: { a: "x" } });
    await expect(analyzeRepository("acme", "widget", { client: new GitHubClient({ fetch: gh.fetch }) })).rejects.toMatchObject({
      code: "private_repository",
    });
  });

  it("reports empty repositories", async () => {
    const gh = fakeGitHub({ size: 0, files: {} });
    const err = await analyzeRepository("acme", "widget", { client: new GitHubClient({ fetch: gh.fetch }) }).catch((e) => e);
    expect(err).toBeInstanceOf(AnalysisError);
    expect(err.code).toBe("empty_repository");
  });

  it("propagates not-found and rate-limit errors", async () => {
    const missing = fakeGitHub({ owner: "other" });
    await expect(analyzeRepository("acme", "widget", { client: new GitHubClient({ fetch: missing.fetch }) })).rejects.toMatchObject({
      code: "not_found",
    });
    const limited = fakeGitHub({
      overrides: { "api.github.com": () => json({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0" }) },
    });
    await expect(analyzeRepository("acme", "widget", { client: new GitHubClient({ fetch: limited.fetch }) })).rejects.toBeInstanceOf(
      GitHubError,
    );
  });

  it("degrades gracefully when language stats fail and the tree is truncated", async () => {
    const gh = fakeGitHub({ files: { "main.py": "print(1)", "README.md": "# x" }, languages: "error", truncated: true });
    const r = await analyzeRepository("acme", "widget", { client: new GitHubClient({ fetch: gh.fetch }) });
    expect(r.stack.languageSource).toBe("file-extensions");
    expect(r.structure.treeTruncated).toBe(true);
    const codes = r.limitations.map((l) => l.code);
    expect(codes).toEqual(expect.arrayContaining(["languages_unavailable", "tree_truncated", "static_only", "sampled_content"]));
  });

  it("enforces file and byte budgets", async () => {
    const files: Record<string, string> = { "README.md": "# x" };
    for (let i = 0; i < 50; i++) files[`config/c${i}.json`] = `{"v": "${"y".repeat(500)}"}`;
    const gh = fakeGitHub({ files });
    const r = await analyzeRepository("acme", "widget", {
      client: new GitHubClient({ fetch: gh.fetch }),
      limits: { maxSampleFiles: 10, maxTotalBytes: 3000, concurrency: 1 },
    });
    expect(r.budget.filesFetched).toBeLessThanOrEqual(11);
    expect(r.budget.bytesFetched).toBeLessThan(3000 + 600);
    expect(r.limitations.map((l) => l.code)).toContain("byte_budget");
    const raw = gh.calls.filter((c) => c.url.startsWith("https://raw.githubusercontent.com"));
    expect(raw.length).toBeLessThanOrEqual(11);
  });

  it("caps the number of tree entries considered", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 30; i++) files[`f${i}.txt`] = "x";
    const r = await analyzeRepository("acme", "widget", {
      client: new GitHubClient({ fetch: fakeGitHub({ files }).fetch }),
      limits: { maxTreeEntries: 10 },
    });
    expect(r.structure.totalFiles).toBeLessThanOrEqual(10);
    expect(r.structure.treeTruncated).toBe(true);
  });

  it("stops at the scan deadline", async () => {
    const gh = fakeGitHub({ files: { "README.md": "# x", "a.json": "{}" } });
    const slow = async (url: string, init?: RequestInit) => {
      if (url.includes("raw.githubusercontent.com")) {
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, 2000);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        });
      }
      return gh.fetch(url, init);
    };
    const r = await analyzeRepository("acme", "widget", { client: new GitHubClient({ fetch: slow }), limits: { deadlineMs: 100 } });
    expect(r.limitations.map((l) => l.code)).toContain("deadline");
    expect(r.budget.filesFetched).toBe(0);
    expect(r.checks.find((c) => c.ruleId === "SEC001")?.status).toBe("unavailable");
  });
});

describe("selectFiles", () => {
  it("prioritizes manifests, CI and env files and respects limits", () => {
    const files = [
      { path: "package.json", size: 100 },
      { path: "README.md", size: 100 },
      { path: ".github/workflows/ci.yml", size: 100 },
      { path: ".env", size: 50 },
      { path: "src/a.ts", size: 100 },
      { path: "node_modules/x/index.js", size: 100 },
      { path: "big.json", size: 10_000_000 },
      { path: "img.png", size: 100 },
      { path: "empty.ts", size: 0 },
    ];
    const { key, sample } = selectFiles(files, DEFAULT_LIMITS);
    expect(key).toEqual(expect.arrayContaining(["package.json", "README.md", ".github/workflows/ci.yml"]));
    expect(sample[0]).toBe(".env");
    expect(sample).toContain("src/a.ts");
    expect([...key, ...sample]).not.toContain("node_modules/x/index.js");
    expect([...key, ...sample]).not.toContain("big.json");
    expect([...key, ...sample]).not.toContain("img.png");
    expect([...key, ...sample]).not.toContain("empty.ts");
  });
});

describe("analyzeContext", () => {
  it("handles a documentation-only repository without inventing scores", () => {
    const r = report({ "README.md": "# Awesome list\n\n- item", LICENSE: "CC0" });
    expect(r.score.categories.find((c) => c.id === "testing")?.score).toBeNull();
    expect(r.limitations.some((l) => l.code === "category_unavailable_testing")).toBe(true);
    expect(r.score.overall).not.toBeNull();
  });

  it("sorts findings by severity", () => {
    const r = report({ "src/a.py": "x", ".env": "A=1" });
    const order = ["critical", "high", "medium", "low", "info"];
    const idx = r.findings.map((f) => order.indexOf(f.severity));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });
});
