import type { FetchLike } from "@/lib/github/client";
import { SHA } from "./helpers";

/**
 * In-memory stand-in for api.github.com and raw.githubusercontent.com,
 * so tests never touch the network.
 */
export type FakeRepo = {
  owner?: string;
  name?: string;
  private?: boolean;
  archived?: boolean;
  size?: number;
  files?: Record<string, string>;
  truncated?: boolean;
  languages?: Record<string, number> | "error";
  /** Override responses for specific URL substrings. */
  overrides?: Record<string, () => Response>;
};

export type FakeGitHub = {
  fetch: FetchLike;
  calls: { url: string; headers: Record<string, string> }[];
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function fakeGitHub(repo: FakeRepo): FakeGitHub {
  const owner = repo.owner ?? "acme";
  const name = repo.name ?? "widget";
  const files = repo.files ?? {};
  const calls: FakeGitHub["calls"] = [];

  const fetchImpl: FetchLike = async (input, init) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, headers });
    for (const [needle, respond] of Object.entries(repo.overrides ?? {})) {
      if (url.includes(needle)) return respond();
    }
    const api = `https://api.github.com/repos/${owner}/${name}`;
    if (url === api) {
      return json({
        name,
        full_name: `${owner}/${name}`,
        owner: { login: owner },
        private: repo.private ?? false,
        html_url: `https://github.com/${owner}/${name}`,
        description: "Fake repo",
        fork: false,
        archived: repo.archived ?? false,
        default_branch: "main",
        stargazers_count: 3,
        forks_count: 1,
        open_issues_count: 0,
        size: repo.size ?? 100,
        pushed_at: "2026-10-01T00:00:00Z",
        license: { spdx_id: "MIT" },
        topics: ["test"],
      });
    }
    if (url === `${api}/branches/main`) {
      if (Object.keys(files).length === 0 && repo.size === 0) return json({ message: "Branch not found" }, 404);
      return json({ name: "main", commit: { sha: SHA } });
    }
    if (url === `${api}/languages`) {
      if (repo.languages === "error") return json({ message: "Server Error" }, 500);
      return json(repo.languages ?? { TypeScript: 1000 });
    }
    if (url === `${api}/git/trees/${SHA}?recursive=1`) {
      const dirs = new Set<string>();
      for (const p of Object.keys(files)) {
        const parts = p.split("/");
        for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
      }
      return json({
        sha: "tree",
        truncated: repo.truncated ?? false,
        tree: [
          ...[...dirs].map((d) => ({ path: d, type: "tree", mode: "040000" })),
          ...Object.entries(files).map(([p, c]) => ({ path: p, type: "blob", size: Buffer.byteLength(c), mode: "100644" })),
        ],
      });
    }
    const rawPrefix = `https://raw.githubusercontent.com/${owner}/${name}/${SHA}/`;
    if (url.startsWith(rawPrefix)) {
      const path = url.slice(rawPrefix.length).split("/").map(decodeURIComponent).join("/");
      if (path in files) return new Response(files[path], { status: 200 });
      return new Response("404: Not Found", { status: 404 });
    }
    return json({ message: "Not Found" }, 404);
  };

  return { fetch: fetchImpl, calls };
}
