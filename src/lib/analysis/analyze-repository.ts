import { GitHubClient, GitHubError, type RepoMetadata, type TreeEntry } from "@/lib/github/client";
import {
  ReportSchema,
  SCHEMA_VERSION,
  SEVERITY_ORDER,
  type CheckResult,
  type Finding,
  type Limitation,
  type Report,
  type RepositoryInfo,
  type Structure,
} from "@/lib/reports/schema";
import {
  buildPathIndex,
  DEFAULT_ANALYSIS_OPTIONS,
  findCommunityFile,
  ORG_COMMUNITY_CANDIDATES,
  type AnalysisContext,
  type AnalysisOptions,
  type BaseContext,
  type RepoFile,
} from "./context";
import { detectStack } from "./detect-stack";
import { manifestEcosystem } from "./manifests";
import { basename, depth, extname, isNonAuthoredPath, isRootFile, isScannableTextFile, isSourceFile, isTestFile } from "./paths";
import { RULES, type Rule } from "./rules";
import { computePlan, computeScore } from "./scoring";
import { ciSystemFor } from "./workflows";

export const ENGINE_VERSION = "0.3.0";

export type ScanLimits = {
  maxTreeEntries: number;
  maxKeyFiles: number;
  maxSampleFiles: number;
  maxKeyFileBytes: number;
  maxSampleFileBytes: number;
  maxTotalBytes: number;
  concurrency: number;
  deadlineMs: number;
};

export const DEFAULT_LIMITS: ScanLimits = {
  maxTreeEntries: 100_000,
  maxKeyFiles: 40,
  maxSampleFiles: 80,
  maxKeyFileBytes: 256 * 1024,
  maxSampleFileBytes: 100 * 1024,
  maxTotalBytes: 3 * 1024 * 1024,
  concurrency: 8,
  deadlineMs: 25_000,
};

export type ProgressEvent =
  | { stage: "metadata"; message: string }
  | { stage: "tree"; message: string }
  | { stage: "files"; message: string; done: number; total: number }
  | { stage: "analysis"; message: string };

export type AnalyzeOptions = {
  client: GitHubClient;
  limits?: Partial<ScanLimits>;
  analysis?: Partial<AnalysisOptions>;
  onProgress?: (event: ProgressEvent) => void;
  now?: () => Date;
  signal?: AbortSignal;
};

export class AnalysisError extends Error {
  constructor(
    public readonly code: "private_repository" | "empty_repository",
    message: string,
  ) {
    super(message);
    this.name = "AnalysisError";
  }
}

// ---------- file selection ----------

const KEY_ROOT_FILE_RE =
  /^(readme(\.(md|markdown|rst|txt|adoc|org))?|package\.json|pyproject\.toml|requirements(-dev|-test|_dev|_test)?\.txt|setup\.py|setup\.cfg|tox\.ini|pipfile|cargo\.toml|go\.mod|gemfile|composer\.json|pom\.xml|build\.gradle(\.kts)?|pubspec\.yaml|deno\.jsonc?|cmakelists\.txt)$/i;

const CONFIG_EXT = new Set([
  "env",
  "json",
  "yml",
  "yaml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "properties",
  "tf",
  "tfvars",
  "sh",
  "xml",
  "npmrc",
]);

export function selectFiles(files: RepoFile[], limits: ScanLimits): { key: string[]; sample: string[] } {
  const key: string[] = [];
  const add = (p: string) => {
    if (!key.includes(p) && key.length < limits.maxKeyFiles) key.push(p);
  };
  const candidates = files.filter((f) => f.size > 0 && !isNonAuthoredPath(f.path));

  // 1. Root manifests and README.
  for (const f of candidates) if (isRootFile(f.path) && KEY_ROOT_FILE_RE.test(f.path) && f.size <= limits.maxKeyFileBytes) add(f.path);
  // 2. Fallback README locations.
  for (const p of [".github/README.md", "docs/README.md"]) if (candidates.some((f) => f.path === p)) add(p);
  // 3. CI configuration (workflows first).
  for (const f of candidates) if (ciSystemFor(f.path) && f.size <= limits.maxKeyFileBytes) add(f.path);
  // 4. Nested package.json files (monorepos), shallow first.
  candidates
    .filter((f) => basename(f.path) === "package.json" && !isRootFile(f.path) && depth(f.path) <= 2)
    .sort((a, b) => depth(a.path) - depth(b.path))
    .slice(0, 10)
    .forEach((f) => add(f.path));
  // 5. Other nested manifests with text we can parse.
  candidates
    .filter((f) => !isRootFile(f.path) && depth(f.path) <= 2 && manifestEcosystem(f.path) && basename(f.path) !== "package.json")
    .slice(0, 5)
    .forEach((f) => f.size <= limits.maxKeyFileBytes && add(f.path));

  // Sample of text files for credential-pattern scanning: config-like files first, then shallow source files.
  const keySet = new Set(key);
  const scannable = candidates.filter((f) => !keySet.has(f.path) && f.size <= limits.maxSampleFileBytes && isScannableTextFile(f.path));
  const priority = (f: RepoFile) => {
    const base = basename(f.path).toLowerCase();
    if (base.startsWith(".env")) return 0;
    if (CONFIG_EXT.has(extname(f.path)) || base === "dockerfile") return 1;
    if (isSourceFile(f.path) && !isTestFile(f.path)) return 2;
    return 3;
  };
  const sample = scannable
    .sort((a, b) => priority(a) - priority(b) || depth(a.path) - depth(b.path) || a.path.localeCompare(b.path))
    .slice(0, limits.maxSampleFiles)
    .map((f) => f.path);

  return { key, sample };
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

// ---------- pure analysis (no I/O) ----------

function buildStructure(ctx: AnalysisContext): Structure {
  const topLevel = new Map<string, "file" | "dir">();
  for (const d of ctx.directories) if (!d.includes("/")) topLevel.set(d, "dir");
  for (const f of ctx.files) if (isRootFile(f.path)) topLevel.set(f.path, "file");
  const topLevelEntries = [...topLevel]
    .map(([name, type]) => ({ name, type }))
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1))
    .slice(0, 200);

  const extCounts = new Map<string, number>();
  for (const f of ctx.files) {
    if (isNonAuthoredPath(f.path)) continue;
    const ext = extname(f.path) || "(none)";
    extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
  }
  const extensions = [...extCounts]
    .map(([extension, count]) => ({ extension, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const dirSet = new Set(ctx.directories.map((d) => d.toLowerCase()));
  const firstDir = (names: string[]) => ctx.directories.find((d) => names.includes(d.toLowerCase())) ?? null;
  const conventions = [
    { name: "Source directory (src/, lib/, app/, pkg/)", path: firstDir(["src", "lib", "app", "pkg", "packages", "cmd", "internal"]) },
    { name: "Tests directory", path: firstDir(["test", "tests", "__tests__", "spec", "e2e"]) },
    { name: "Documentation directory (docs/)", path: firstDir(["docs", "doc", "documentation"]) },
    { name: "GitHub configuration (.github/)", path: dirSet.has(".github") ? ".github" : null },
    { name: "Examples", path: firstDir(["examples", "example", "samples"]) },
    { name: "Scripts / tooling", path: firstDir(["scripts", "tools", "bin"]) },
    {
      name: "Changelog",
      path: ctx.files.find((f) => isRootFile(f.path) && /^(changelog|changes|history)(\.(md|rst|txt))?$/i.test(f.path))?.path ?? null,
    },
  ].map((c) => ({ ...c, present: c.path !== null }));

  return {
    totalFiles: ctx.files.length,
    totalDirectories: ctx.directories.length,
    sourceFiles: ctx.files.filter((f) => isSourceFile(f.path)).length,
    testFiles: ctx.files.filter((f) => isTestFile(f.path)).length,
    totalBytes: ctx.files.reduce((a, f) => a + f.size, 0),
    treeTruncated: ctx.treeTruncated,
    topLevelEntries,
    extensions,
    conventions,
  };
}

export function runRules(ctx: AnalysisContext, rules: Rule[] = RULES): { checks: CheckResult[]; findings: Finding[] } {
  const checks: CheckResult[] = [];
  const findings: Finding[] = [];
  for (const rule of rules) {
    let outcome;
    try {
      outcome = rule.evaluate(ctx);
    } catch {
      // A defective rule must never break the whole report.
      outcome = { status: "unavailable" as const, summary: "This check failed to run." };
    }
    checks.push({
      ruleId: rule.id,
      title: rule.title,
      category: rule.category,
      scoreCategory: rule.scoreCategory,
      weight: rule.weight,
      status: outcome.status,
      summary: outcome.summary,
      kind: rule.kind,
    });
    (outcome.findings ?? []).forEach((draft, i) => {
      findings.push({
        id: `${rule.id}-${i + 1}`,
        ruleId: rule.id,
        category: rule.category,
        rationale: rule.rationale,
        kind: rule.kind,
        ...draft,
        evidence: draft.evidence.slice(0, 50).map((e) => ({ ...e, detail: e.detail.slice(0, 1000) })),
      });
    });
  }
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.ruleId.localeCompare(b.ruleId));
  return { checks, findings };
}

export type AnalyzeContextInput = BaseContext & {
  limitations?: Limitation[];
  budget?: Report["budget"];
  generatedAt?: Date;
};

/** Pure: turns gathered repository data into a validated report. */
export function analyzeContext(input: AnalyzeContextInput): Report {
  const stack = detectStack(input);
  const ctx: AnalysisContext = { ...input, stack, pathIndex: buildPathIndex(input.files) };
  const { checks, findings } = runRules(ctx);
  const score = computeScore(checks);
  const limitations: Limitation[] = [
    {
      code: "static_only",
      message:
        "Static analysis only: RepoPilot never runs repository code, installs dependencies, or executes tests. Detected tests were not run.",
    },
    ...(input.limitations ?? []),
  ];
  for (const c of score.categories) {
    if (c.score === null) limitations.push({ code: `category_unavailable_${c.id}`, message: `${c.label}: ${c.explanation}` });
  }
  const repo = input.repository;
  const report: Report = {
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    id: `${repo.fullName}@${repo.commitSha.slice(0, 12)}`,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    repository: repo,
    stack,
    structure: buildStructure(ctx),
    checks,
    findings,
    score,
    plan: computePlan(checks),
    limitations,
    budget: input.budget ?? { apiRequests: 0, filesFetched: input.contents.size, filesSkipped: 0, bytesFetched: 0, durationMs: 0 },
  };
  return ReportSchema.parse(report);
}

// ---------- orchestration (I/O) ----------

export async function findOrgCommunityFiles(
  client: GitHubClient,
  owner: string,
  repo: string,
  files: RepoFile[],
  signal?: AbortSignal,
): Promise<{ contributing: string | null; security: string | null }> {
  const lookup = async (name: "contributing" | "security"): Promise<string | null> => {
    if (repo.toLowerCase() === ".github" || findCommunityFile(files, name)) return null;
    for (const path of ORG_COMMUNITY_CANDIDATES[name]) {
      if (signal?.aborted) return null;
      if (await client.rawFileExists(owner, ".github", path, signal)) return `${owner}/.github/${path}`;
    }
    return null;
  };
  const [contributing, security] = await Promise.all([lookup("contributing"), lookup("security")]);
  return { contributing, security };
}

function toRepositoryInfo(meta: RepoMetadata, sha: string): RepositoryInfo {
  return {
    owner: meta.owner.login,
    name: meta.name,
    fullName: meta.full_name,
    url: `https://github.com/${meta.full_name}`,
    description: meta.description ? meta.description.slice(0, 500) : null,
    defaultBranch: meta.default_branch,
    commitSha: sha,
    stars: meta.stargazers_count,
    forks: meta.forks_count,
    openIssues: meta.open_issues_count,
    archived: meta.archived,
    fork: meta.fork,
    license: meta.license?.spdx_id ?? null,
    sizeKb: meta.size,
    pushedAt: meta.pushed_at ?? null,
    topics: (meta.topics ?? []).slice(0, 20),
  };
}

export async function analyzeRepository(owner: string, repo: string, options: AnalyzeOptions): Promise<Report> {
  const started = Date.now();
  const limits: ScanLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const analysisOptions: AnalysisOptions = { ...DEFAULT_ANALYSIS_OPTIONS, ...options.analysis };
  const { client, onProgress } = options;
  const limitations: Limitation[] = [];

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), limits.deadlineMs);
  const signal = options.signal ? AbortSignal.any([deadline.signal, options.signal]) : deadline.signal;

  try {
    onProgress?.({ stage: "metadata", message: "Fetching repository metadata" });
    const meta = await client.getRepository(owner, repo, signal);
    if (meta.private) throw new AnalysisError("private_repository", "RepoPilot only analyzes public repositories.");

    const [shaResult, languagesResult] = await Promise.allSettled([
      client.getBranchHead(meta.owner.login, meta.name, meta.default_branch, signal),
      client.getLanguages(meta.owner.login, meta.name, signal),
    ]);
    if (shaResult.status === "rejected") {
      const err = shaResult.reason;
      if (err instanceof GitHubError && err.code === "not_found" && meta.size === 0) {
        throw new AnalysisError("empty_repository", "This repository is empty, so there is nothing to analyze yet.");
      }
      throw err;
    }
    const sha = shaResult.value;
    let languages: Record<string, number> | null = null;
    if (languagesResult.status === "fulfilled") {
      languages = languagesResult.value;
    } else {
      const err = languagesResult.reason;
      if (err instanceof GitHubError && err.code === "rate_limited") throw err;
      limitations.push({
        code: "languages_unavailable",
        message: "GitHub language statistics were unavailable; languages were estimated from file extensions.",
      });
    }

    onProgress?.({ stage: "tree", message: "Reading the file tree" });
    let treeEntries: TreeEntry[];
    let truncated: boolean;
    try {
      const tree = await client.getTree(meta.owner.login, meta.name, sha, signal);
      treeEntries = tree.tree;
      truncated = tree.truncated;
    } catch (err) {
      if (err instanceof GitHubError && (err.code === "empty_repository" || (err.code === "not_found" && meta.size === 0))) {
        throw new AnalysisError("empty_repository", "This repository is empty, so there is nothing to analyze yet.");
      }
      if (err instanceof GitHubError && err.code === "too_large") {
        throw new GitHubError("too_large", "This repository's file tree is too large to analyze within RepoPilot's limits.");
      }
      throw err;
    }
    if (treeEntries.length > limits.maxTreeEntries) {
      treeEntries = treeEntries.slice(0, limits.maxTreeEntries);
      truncated = true;
    }
    if (truncated) {
      limitations.push({
        code: "tree_truncated",
        message: `The repository tree is very large; only the first ${treeEntries.length.toLocaleString("en-US")} entries were analyzed. Results for unlisted paths may be incomplete.`,
      });
    }
    const files: RepoFile[] = treeEntries
      .filter((e) => e.type === "blob" && e.path.length <= 1024)
      .map((e) => ({ path: e.path, size: e.size ?? 0 }));
    const directories = treeEntries.filter((e) => e.type === "tree").map((e) => e.path);
    if (files.length === 0) {
      throw new AnalysisError("empty_repository", "This repository has no files on its default branch.");
    }

    // ---- bounded content fetching ----
    const { key, sample } = selectFiles(files, limits);
    const queue = [...key, ...sample];
    const contents = new Map<string, string>();
    let bytesFetched = 0;
    let skipped = 0;
    let done = 0;
    let rawRateLimited = false;
    let deadlineHit = false;
    onProgress?.({ stage: "files", message: "Inspecting selected files", done: 0, total: queue.length });

    await runPool(queue, limits.concurrency, async (path) => {
      if (signal.aborted || rawRateLimited || bytesFetched >= limits.maxTotalBytes) {
        if (deadline.signal.aborted) deadlineHit = true;
        skipped++;
        return;
      }
      const cap = key.includes(path) ? limits.maxKeyFileBytes : limits.maxSampleFileBytes;
      try {
        const text = await client.getRawFile(meta.owner.login, meta.name, sha, path, cap, signal);
        if (text === null) {
          skipped++;
        } else {
          contents.set(path, text);
          bytesFetched += new TextEncoder().encode(text).byteLength;
        }
      } catch (err) {
        skipped++;
        if (err instanceof GitHubError && err.code === "rate_limited") rawRateLimited = true;
        if (deadline.signal.aborted) deadlineHit = true;
        if (options.signal?.aborted) throw err;
      } finally {
        done++;
        onProgress?.({ stage: "files", message: "Inspecting selected files", done, total: queue.length });
      }
    });

    const scannableTotal = files.filter((f) => isScannableTextFile(f.path) && !isNonAuthoredPath(f.path)).length;
    if (deadlineHit) limitations.push({ code: "deadline", message: "The scan time budget was reached; some files were not inspected." });
    if (rawRateLimited)
      limitations.push({
        code: "raw_rate_limited",
        message: "GitHub limited file downloads during this scan; some files were not inspected.",
      });
    if (bytesFetched >= limits.maxTotalBytes)
      limitations.push({ code: "byte_budget", message: "The per-scan byte budget was reached; remaining files were not inspected." });
    if (skipped > 0)
      limitations.push({
        code: "files_skipped",
        message: `${skipped} selected file(s) were skipped (binary, too large, unavailable, or over budget).`,
      });
    limitations.push({
      code: "sampled_content",
      message: `File contents were inspected for ${contents.size} of ${files.length} files (manifests, CI configuration, README and a sample of up to ${limits.maxSampleFiles} text files for credential patterns, ${scannableTotal} candidate text files in total). Other checks use file names and sizes only.`,
    });

    // GitHub applies community health files from {owner}/.github to repos without their own.
    // Checked via raw.githubusercontent.com (no API quota), best-effort, only when missing locally.
    const orgCommunityFiles = await findOrgCommunityFiles(client, meta.owner.login, meta.name, files, signal);

    onProgress?.({ stage: "analysis", message: "Running checks and scoring" });
    return analyzeContext({
      orgCommunityFiles,
      repository: toRepositoryInfo(meta, sha),
      files,
      directories,
      treeTruncated: truncated,
      languages,
      contents,
      options: analysisOptions,
      limitations,
      generatedAt: options.now?.(),
      budget: {
        apiRequests: client.apiRequests,
        filesFetched: contents.size,
        filesSkipped: skipped,
        bytesFetched,
        durationMs: Date.now() - started,
      },
    });
  } catch (err) {
    if (deadline.signal.aborted && !(err instanceof AnalysisError) && !(err instanceof GitHubError && err.code !== "timeout")) {
      throw new GitHubError("timeout", "The analysis took too long and was stopped. Try again later.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
