import type { RepositoryInfo, Stack } from "@/lib/reports/schema";
import { basename } from "./paths";

export type RepoFile = { path: string; size: number };

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
