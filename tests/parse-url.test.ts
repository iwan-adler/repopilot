import { describe, expect, it } from "vitest";
import { parseGitHubRepoUrl } from "@/lib/github/parse-url";

function ok(input: string) {
  const r = parseGitHubRepoUrl(input);
  if (!r.ok) throw new Error(`expected ok for ${input}: ${r.error}`);
  return r.value;
}

describe("parseGitHubRepoUrl", () => {
  it.each([
    ["https://github.com/vercel/next.js", "vercel", "next.js"],
    ["http://github.com/vercel/next.js", "vercel", "next.js"],
    ["https://www.github.com/vercel/next.js/", "vercel", "next.js"],
    ["github.com/vercel/next.js", "vercel", "next.js"],
    ["https://github.com/vercel/next.js.git", "vercel", "next.js"],
    ["git@github.com:vercel/next.js.git", "vercel", "next.js"],
    ["vercel/next.js", "vercel", "next.js"],
    ["  https://github.com/facebook/react  ", "facebook", "react"],
    ["https://github.com/facebook/react/tree/main/packages", "facebook", "react"],
    ["https://github.com/facebook/react/blob/main/README.md?plain=1#L5", "facebook", "react"],
    ["https://GitHub.com/Some-User/My_Repo-2", "Some-User", "My_Repo-2"],
    ["https://github.com/a/b", "a", "b"],
  ])("accepts %s", (input, owner, repo) => {
    const v = ok(input);
    expect(v.owner).toBe(owner);
    expect(v.repo).toBe(repo);
    expect(v.url).toBe(`https://github.com/${owner}/${repo}`);
  });

  it.each([
    ["", /Enter/],
    ["   ", /Enter/],
    ["https://gitlab.com/owner/repo", /github\.com/],
    ["https://github.com.evil.com/owner/repo", /github\.com/],
    ["https://evil.com/github.com/owner/repo", /github\.com/],
    ["https://gist.github.com/owner/abc123", /github\.com/],
    ["https://api.github.com/repos/owner/repo", /github\.com/],
    ["https://user:pass@github.com/owner/repo", /credentials/],
    ["https://github.com:8443/owner/repo", /port/],
    ["ftp://github.com/owner/repo", /http/],
    ["javascript:alert(1)", /./],
    ["https://github.com/owner", /owner and repository/],
    ["https://github.com/", /owner and repository/],
    ["https://github.com/-bad/repo", /owner/],
    ["https://github.com/owner/re po", /invalid characters/],
    ["https://github.com/owner/..", /repository name/],
    ["https://github.com/owner/%2e%2e", /repository name/],
    ["https://github.com/owner/repo%2Fextra", /repository name/],
    ["https://github.com/settings/profile", /GitHub page/],
    ["https://github.com/orgs/vercel", /GitHub page/],
    ["https://github.com/owner/%E0%A4%A", /percent-encoding/],
    ["https://github.com/own\ner/repo", /invalid characters/],
    ["owner/repo/extra", /./],
    [`https://github.com/owner/${"a".repeat(400)}`, /too long/],
  ])("rejects %s", (input, message) => {
    const r = parseGitHubRepoUrl(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });

  it("rejects non-string input", () => {
    expect(parseGitHubRepoUrl(undefined).ok).toBe(false);
    expect(parseGitHubRepoUrl(42).ok).toBe(false);
    expect(parseGitHubRepoUrl({ url: "x" }).ok).toBe(false);
  });

  it("rejects an owner longer than 39 characters", () => {
    expect(parseGitHubRepoUrl(`https://github.com/${"a".repeat(40)}/repo`).ok).toBe(false);
  });

  it("rejects a repository name longer than 100 characters", () => {
    expect(parseGitHubRepoUrl(`https://github.com/owner/${"r".repeat(101)}`).ok).toBe(false);
  });
});
