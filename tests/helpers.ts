import { analyzeContext } from "@/lib/analysis/analyze-repository";
import { buildPathIndex, DEFAULT_ANALYSIS_OPTIONS, type AnalysisContext, type BaseContext } from "@/lib/analysis/context";
import { detectStack } from "@/lib/analysis/detect-stack";
import { RULES } from "@/lib/analysis/rules";
import type { RepositoryInfo } from "@/lib/reports/schema";

export const SHA = "0123456789abcdef0123456789abcdef01234567";

export function repoInfo(overrides: Partial<RepositoryInfo> = {}): RepositoryInfo {
  return {
    owner: "acme",
    name: "widget",
    fullName: "acme/widget",
    url: "https://github.com/acme/widget",
    description: "A test repository",
    defaultBranch: "main",
    commitSha: SHA,
    stars: 1,
    forks: 0,
    openIssues: 0,
    archived: false,
    fork: false,
    license: null,
    sizeKb: 10,
    pushedAt: "2026-10-01T00:00:00Z",
    topics: [],
    ...overrides,
  };
}

/**
 * Fixture spec: path -> file content (string, fetched) or byte size (number, tree only).
 * Directories are derived from the paths.
 */
export type FileSpec = Record<string, string | number>;

export function baseContext(spec: FileSpec, extra: Partial<BaseContext> = {}): BaseContext {
  const files = Object.entries(spec).map(([path, v]) => ({
    path,
    size: typeof v === "number" ? v : Buffer.byteLength(v),
  }));
  const dirs = new Set<string>();
  for (const f of files) {
    const parts = f.path.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  const contents = new Map<string, string>();
  for (const [path, v] of Object.entries(spec)) if (typeof v === "string") contents.set(path, v);
  return {
    repository: repoInfo(),
    files,
    directories: [...dirs].sort(),
    treeTruncated: false,
    languages: null,
    contents,
    options: DEFAULT_ANALYSIS_OPTIONS,
    ...extra,
  };
}

export function context(spec: FileSpec, extra: Partial<BaseContext> = {}): AnalysisContext {
  const base = baseContext(spec, extra);
  return { ...base, stack: detectStack(base), pathIndex: buildPathIndex(base.files) };
}

export function evaluate(ruleId: string, spec: FileSpec, extra: Partial<BaseContext> = {}) {
  const rule = RULES.find((r) => r.id === ruleId);
  if (!rule) throw new Error(`Unknown rule ${ruleId}`);
  return rule.evaluate(context(spec, extra));
}

export function report(spec: FileSpec, extra: Partial<BaseContext> = {}) {
  return analyzeContext({ ...baseContext(spec, extra), generatedAt: new Date("2026-10-20T00:00:00Z") });
}

export const GOOD_README = `# Widget

Widget is a small library that does useful things for testing RepoPilot's README checks.
It has enough prose here to count as substantive content for the completeness heuristic,
which requires at least three hundred characters of text in the document body overall.

## Installation

\`\`\`bash
npm install widget
\`\`\`

## Usage

\`\`\`js
import { widget } from "widget";
widget();
\`\`\`
`;

/** A healthy small TypeScript project used across tests. */
export const HEALTHY_PROJECT: FileSpec = {
  "README.md": GOOD_README,
  LICENSE: "MIT License",
  "CONTRIBUTING.md": "How to contribute",
  "SECURITY.md": "Report privately",
  ".gitignore": "node_modules\n.env\n",
  "package.json": JSON.stringify({
    name: "widget",
    private: true,
    scripts: { dev: "next dev", build: "next build", lint: "eslint", test: "vitest run" },
    dependencies: { next: "16.0.0", react: "19.0.0" },
    devDependencies: { vitest: "^5.0.0", eslint: "^9.0.0", prettier: "^3.0.0" },
  }),
  "package-lock.json": 5000,
  "eslint.config.mjs": "export default []",
  ".prettierrc": "{}",
  ".github/dependabot.yml": "version: 2",
  ".github/workflows/ci.yml": `name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test
`,
  "src/index.ts": "export const x = 1;\n",
  "src/index.test.ts": "import { x } from './index';\n",
};
