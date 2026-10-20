import { describe, expect, it } from "vitest";
import { encodeRepoPath, GitHubClient, GitHubError, type FetchLike } from "@/lib/github/client";
import { json } from "./fake-github";
import { SHA } from "./helpers";

function clientWith(fetchImpl: FetchLike, extra: Partial<ConstructorParameters<typeof GitHubClient>[0]> = {}) {
  return new GitHubClient({ fetch: fetchImpl, ...extra });
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(GitHubError);
  await p.catch((e: GitHubError) => expect(e.code).toBe(code));
}

const validRepo = {
  name: "widget",
  full_name: "acme/widget",
  owner: { login: "acme" },
  private: false,
  html_url: "https://github.com/acme/widget",
  description: null,
  fork: false,
  archived: false,
  default_branch: "main",
  stargazers_count: 0,
  forks_count: 0,
  open_issues_count: 0,
  size: 1,
};

describe("GitHubClient", () => {
  it("parses repository metadata", async () => {
    const c = clientWith(async () => json(validRepo));
    const meta = await c.getRepository("acme", "widget");
    expect(meta.full_name).toBe("acme/widget");
    expect(c.apiRequests).toBe(1);
  });

  it("maps 404 to not_found", async () => {
    await expectCode(clientWith(async () => json({ message: "Not Found" }, 404)).getRepository("a", "b"), "not_found");
  });

  it("detects primary rate limiting (403 + remaining 0) and exposes reset time", async () => {
    const c = clientWith(async () =>
      json({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1900000000" }),
    );
    const err = await c.getRepository("a", "b").catch((e) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.code).toBe("rate_limited");
    expect(err.resetAt).toBe(1900000000);
  });

  it("detects secondary rate limiting (403 with message) and 429", async () => {
    await expectCode(clientWith(async () => json({ message: "You have exceeded a secondary rate limit" }, 403)).getRepository("a", "b"), "rate_limited");
    await expectCode(clientWith(async () => json({ message: "slow down" }, 429)).getRepository("a", "b"), "rate_limited");
  });

  it("maps other 403s to forbidden and 5xx to upstream_error", async () => {
    await expectCode(clientWith(async () => json({ message: "Repository access blocked" }, 403)).getRepository("a", "b"), "forbidden");
    await expectCode(clientWith(async () => json({ message: "oops" }, 502)).getRepository("a", "b"), "upstream_error");
  });

  it("maps 409 empty repository on tree fetch", async () => {
    await expectCode(clientWith(async () => json({ message: "Git Repository is empty." }, 409)).getTree("a", "b", SHA), "empty_repository");
  });

  it("rejects malformed JSON and unexpected shapes", async () => {
    await expectCode(clientWith(async () => new Response("{not json", { status: 200 })).getRepository("a", "b"), "invalid_response");
    await expectCode(clientWith(async () => json({ name: 5 })).getRepository("a", "b"), "invalid_response");
    await expectCode(clientWith(async () => json({ sha: "x", tree: [{ path: "a", type: "weird" }], truncated: false })).getTree("a", "b", SHA), "invalid_response");
  });

  it("rejects an invalid SHA before making a request", async () => {
    let called = false;
    const c = clientWith(async () => {
      called = true;
      return json({});
    });
    expect(() => c.getTree("a", "b", "main")).toThrow(GitHubError);
    await expect(c.getRawFile("a", "b", "../../x", "f", 100)).rejects.toBeInstanceOf(GitHubError);
    expect(called).toBe(false);
  });

  it("enforces the response size cap via content-length and streaming", async () => {
    await expectCode(
      clientWith(async () => new Response("x".repeat(10), { headers: { "content-length": "999999999" } })).getRepository("a", "b"),
      "too_large",
    );
    const big = clientWith(async () => json({ ...validRepo, description: "y".repeat(5000) }), { maxJsonBytes: 1000 });
    await expectCode(big.getRepository("a", "b"), "too_large");
    const raw = clientWith(async () => new Response("z".repeat(2000)));
    await expectCode(raw.getRawFile("a", "b", SHA, "big.txt", 1000), "too_large");
  });

  it("maps timeouts", async () => {
    const c = clientWith(async (_url, init) => {
      await new Promise((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })));
      });
      return json({});
    }, { timeoutMs: 20 });
    await expectCode(c.getRepository("a", "b"), "timeout");
  });

  it("maps network failures to upstream_error", async () => {
    await expectCode(clientWith(async () => { throw new TypeError("fetch failed"); }).getRepository("a", "b"), "upstream_error");
  });

  it("follows redirects only within allowed GitHub origins", async () => {
    const urls: string[] = [];
    const ok = clientWith(async (url) => {
      urls.push(url);
      if (url.endsWith("/repos/old/name")) return new Response(null, { status: 301, headers: { location: "https://api.github.com/repositories/1" } });
      return json(validRepo);
    });
    await ok.getRepository("old", "name");
    expect(urls).toEqual(["https://api.github.com/repos/old/name", "https://api.github.com/repositories/1"]);

    const evil = clientWith(async () => new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } }));
    await expectCode(evil.getRepository("a", "b"), "invalid_response");
  });

  it("stops after too many redirects", async () => {
    const loop = clientWith(async () => new Response(null, { status: 301, headers: { location: "https://api.github.com/repos/a/b" } }));
    await expectCode(loop.getRepository("a", "b"), "invalid_response");
  });

  it("sends the token only to the API origin", async () => {
    const seen: { url: string; auth?: string }[] = [];
    const c = clientWith(async (url, init) => {
      const h = init?.headers as Record<string, string>;
      seen.push({ url, auth: h.Authorization });
      return url.startsWith("https://api.github.com") ? json(validRepo) : new Response("hello");
    }, { token: "test-token-value" });
    await c.getRepository("acme", "widget");
    await c.getRawFile("acme", "widget", SHA, "README.md", 1000);
    expect(seen[0].auth).toBe("Bearer test-token-value");
    expect(seen[1].url.startsWith("https://raw.githubusercontent.com/")).toBe(true);
    expect(seen[1].auth).toBeUndefined();
  });

  it("encodes repository paths and returns null for binary content", async () => {
    let requested = "";
    const c = clientWith(async (url) => {
      requested = url;
      return new Response(new Uint8Array([0x89, 0x50, 0x00, 0x01]));
    });
    expect(await c.getRawFile("acme", "widget", SHA, "img/a b#?.png", 1000)).toBeNull();
    expect(requested).toBe(`https://raw.githubusercontent.com/acme/widget/${SHA}/img/a%20b%23%3F.png`);
  });

  it("refuses unsafe repository paths", () => {
    expect(() => encodeRepoPath("../etc/passwd")).toThrow(GitHubError);
    expect(() => encodeRepoPath("a//b")).toThrow(GitHubError);
    expect(encodeRepoPath("src/index.ts")).toBe("src/index.ts");
  });

  it("records the remaining rate-limit header", async () => {
    const c = clientWith(async () => json(validRepo, 200, { "x-ratelimit-remaining": "42" }));
    await c.getRepository("a", "b");
    expect(c.rateLimitRemaining).toBe(42);
  });
});
