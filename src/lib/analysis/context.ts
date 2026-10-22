import type { RepositoryInfo, Stack } from "@/lib/reports/schema";
import { basename } from "./paths";

/** A blob in the tree. `symlink` is set for symbolic links (Git mode 120000), whose content is the target path. */
export type RepoFile = { path: string; size: number; symlink?: boolean };

export type AnalysisOptions = {
  /** Source files larger than this (bytes) are reported as oversized. */
  oversizedFileBytes: number;
  /** Files larger than this (bytes) are reported as large binaries / large committed files. */
  largeFileBytes: number;
};

export const DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions = {
  oversizedFileBytes: 100 * 1024,
  largeFileBytes: 5 * 1024 * 1024,
};

/** Everything the rules may look at. Built from GitHub data; rules never perform I/O. */
export type BaseContext = {
  repository: RepositoryInfo;
  /** All blobs in the (possibly truncated) tree. */
  files: RepoFile[];
  directories: string[];
  treeTruncated: boolean;
  /** Bytes per language from GitHub's linguist, or null when unavailable. */
  languages: Record<string, number> | null;
  /** Text contents of the files that were fetched (path -> content). */
  contents: Map<string, string>;
  options: AnalysisOptions;
  /**
   * Community health files inherited from the owner's `.github` repository
   * (e.g. "acme/.github/SECURITY.md"); GitHub applies these to repos without their own.
   */
  orgCommunityFiles?: { contributing: string | null; security: string | null };
};

/**
 * GitHub community health files may live in the root, docs/ or .github/, with any common
 * documentation extension (e.g. docs/contributing.rst). Matching is case-insensitive.
 */
export function findCommunityFile(files: RepoFile[], name: "contributing" | "security"): string | null {
  const re = new RegExp(`^(\\.github/|docs/)?${name}(\\.(md|markdown|rst|txt|adoc|org))?$`, "i");
  return files.find((f) => re.test(f.path))?.path ?? null;
}

/** Locations GitHub checks for organization-wide defaults in `{owner}/.github` (case-sensitive on raw URLs). */
export const ORG_COMMUNITY_CANDIDATES: Record<"contributing" | "security", string[]> = {
  contributing: ["CONTRIBUTING.md", ".github/CONTRIBUTING.md", "docs/CONTRIBUTING.md", "contributing.md", ".github/contributing.md"],
  security: ["SECURITY.md", ".github/SECURITY.md", "docs/SECURITY.md", "security.md"],
};

export type AnalysisContext = BaseContext & {
  stack: Stack;
  /** Lower-cased path -> original path, for case-insensitive lookups. */
  pathIndex: Map<string, string>;
};

export function buildPathIndex(files: RepoFile[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const f of files) index.set(f.path.toLowerCase(), f.path);
  return index;
}

/** Finds the first existing path among candidates (case-insensitive). */
export function findPath(ctx: Pick<AnalysisContext, "pathIndex">, candidates: string[]): string | null {
  for (const c of candidates) {
    const hit = ctx.pathIndex.get(c.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/** Root-level files whose basename matches the pattern. */
export function findRootFiles(files: RepoFile[], pattern: RegExp): RepoFile[] {
  return files.filter((f) => !f.path.includes("/") && pattern.test(basename(f.path)));
}
