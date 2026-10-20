/**
 * Strict parser for public GitHub repository references.
 *
 * Accepted forms:
 *   https://github.com/owner/repo            (http, www., trailing slash, .git, extra path, query, hash)
 *   github.com/owner/repo
 *   git@github.com:owner/repo.git
 *   owner/repo
 *
 * Everything else (other hosts, credentials, ports, gists, reserved GitHub routes,
 * malformed names) is rejected. The parser never performs network access.
 */

export type ParsedRepository = {
  owner: string;
  repo: string;
  /** Canonical, normalized https URL. */
  url: string;
};

export type ParseResult = { ok: true; value: ParsedRepository } | { ok: false; error: string };

export const MAX_INPUT_LENGTH = 300;

// GitHub usernames: alphanumeric or hyphen, cannot start with a hyphen, max 39 chars.
// (Some legacy accounts contain consecutive or trailing hyphens, so those are tolerated.)
const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
// Repository names: letters, digits, '.', '-', '_' up to 100 chars.
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

// First path segments on github.com that are product routes, not user accounts.
const RESERVED_OWNERS = new Set([
  "about",
  "account",
  "apps",
  "blog",
  "codespaces",
  "collections",
  "contact",
  "customer-stories",
  "dashboard",
  "enterprise",
  "events",
  "explore",
  "features",
  "issues",
  "join",
  "login",
  "logout",
  "marketplace",
  "new",
  "notifications",
  "orgs",
  "organizations",
  "pricing",
  "pulls",
  "search",
  "security",
  "settings",
  "site",
  "sponsors",
  "topics",
  "trending",
  "users",
]);

const ALLOWED_HOSTS = new Set(["github.com", "www.github.com"]);

function fail(error: string): ParseResult {
  return { ok: false, error };
}

export function parseGitHubRepoUrl(rawInput: unknown): ParseResult {
  if (typeof rawInput !== "string") return fail("Enter a GitHub repository URL.");
  const input = rawInput.trim();
  if (input.length === 0) return fail("Enter a GitHub repository URL.");
  if (input.length > MAX_INPUT_LENGTH) return fail("That URL is too long.");
  // Reject control characters and whitespace inside the value.
  if (/[\s\u0000-\u001f\u007f]/.test(input)) return fail("The URL contains invalid characters.");

  let pathPart: string;

  const sshMatch = /^git@github\.com:(.+)$/i.exec(input);
  if (sshMatch) {
    pathPart = sshMatch[1];
  } else if (/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/.test(input)) {
    // owner/repo shorthand
    pathPart = input;
  } else {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
    let url: URL;
    try {
      url = new URL(withScheme);
    } catch {
      return fail("That doesn't look like a valid URL.");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return fail("Only http(s) GitHub URLs are supported.");
    }
    if (url.username || url.password) return fail("URLs containing credentials are not accepted.");
    if (url.port) return fail("URLs with a custom port are not accepted.");
    if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
      return fail("Only repositories hosted on github.com are supported.");
    }
    pathPart = url.pathname;
  }

  const segments = pathPart.split("/").filter((s) => s.length > 0);
  if (segments.length < 2) return fail("Include both the owner and repository name, e.g. github.com/owner/repo.");

  let owner: string;
  let repo: string;
  try {
    owner = decodeURIComponent(segments[0]);
    repo = decodeURIComponent(segments[1]);
  } catch {
    return fail("The URL contains invalid percent-encoding.");
  }
  if (repo.toLowerCase().endsWith(".git")) repo = repo.slice(0, -4);

  if (!OWNER_RE.test(owner)) return fail("The repository owner name is not valid.");
  if (RESERVED_OWNERS.has(owner.toLowerCase())) return fail("That is a GitHub page, not a repository URL.");
  if (!REPO_RE.test(repo) || repo === "." || repo === "..") {
    return fail("The repository name is not valid.");
  }

  return {
    ok: true,
    value: { owner, repo, url: `https://github.com/${owner}/${repo}` },
  };
}
