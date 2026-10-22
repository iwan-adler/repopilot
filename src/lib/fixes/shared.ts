/**
 * Types and helpers shared by the fix-it kit modules.
 *
 * Every repository-derived value (paths, names, branch) is sanitized before being placed in a
 * template, because file names in a repository are untrusted input.
 */
import type { Report } from "@/lib/reports/schema";

export type FixFile = {
  path: string;
  /** "create": a new file. "snippet": content to merge into an existing file. */
  kind: "create" | "snippet";
  content: string;
};

export type FixKit = {
  ruleId: string;
  title: string;
  files: FixFile[];
  /** Shell commands for the user to run locally (never executed by RepoPilot). */
  commands: string[];
  notes: string[];
};

// ---------- sanitizing ----------

export const SAFE_PATH_RE = /^[A-Za-z0-9._\-/]+$/;

/** Returns the path if it only contains safe characters and no traversal, else null. */
export function safePath(path: string): string | null {
  if (!SAFE_PATH_RE.test(path) || path.length > 200) return null;
  if (path.split("/").some((s) => s === "" || s === "." || s === "..")) return null;
  return path;
}

/** Default branch name if it is plain, else "main" (it is inserted into YAML and Markdown). */
export function branchOf(report: Report): string {
  return /^[A-Za-z0-9._\-/]{1,100}$/.test(report.repository.defaultBranch) ? report.repository.defaultBranch : "main";
}

export function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "." : path.slice(0, i);
}

/** Single-quotes a path for POSIX shells. Inputs are already restricted by safePath. */
export function sh(path: string): string {
  return `'${path}'`;
}

// ---------- stack detection for templates ----------

export type Stack = {
  node: boolean;
  typescript: boolean;
  python: boolean;
  go: boolean;
  rust: boolean;
  ruby: boolean;
  maven: boolean;
  gradle: boolean;
  nodeManager: "npm" | "pnpm" | "yarn";
  hasNodeLockfile: boolean;
  nodeDir: string;
  pythonDir: string;
  hasRequirements: boolean;
  hasPyproject: boolean;
  rspec: boolean;
  testFrameworks: string[];
};

export function firstManifestDir(report: Report, names: string[]): string | null {
  const m = report.stack.manifests.find((x) => names.includes(x.path.split("/").pop()!.toLowerCase()));
  if (!m) return null;
  const p = safePath(m.path);
  return p ? dirOf(p) : null;
}

export function describeStack(report: Report): Stack {
  const eco = report.stack.ecosystems;
  const langs = report.stack.languages.map((l) => l.name);
  const pms = report.stack.packageManagers.map((p) => p.name);
  const manifests = report.stack.manifests.map((m) => m.path.split("/").pop()!.toLowerCase());
  const nodeManager = pms.includes("pnpm") ? "pnpm" : pms.includes("Yarn") ? "yarn" : "npm";
  return {
    node: eco.some((e) => e.startsWith("JavaScript")),
    typescript: langs.includes("TypeScript"),
    // Many Python projects (scripts, research code) have no manifest, so language share counts too.
    // Other toolchains need their manifest for the generated commands to work.
    python: eco.includes("Python") || report.stack.languages.some((l) => l.name === "Python" && l.percent >= 10),
    go: eco.includes("Go"),
    rust: eco.includes("Rust"),
    ruby: eco.includes("Ruby"),
    maven: eco.includes("Java (Maven)"),
    gradle: eco.includes("JVM (Gradle)"),
    nodeManager,
    hasNodeLockfile: report.stack.packageManagers.some(
      (p) => ["npm", "pnpm", "Yarn"].includes(p.name) && /lock|shrinkwrap/.test(p.evidence),
    ),
    nodeDir: firstManifestDir(report, ["package.json"]) ?? ".",
    pythonDir: firstManifestDir(report, ["pyproject.toml", "requirements.txt", "setup.py", "pipfile"]) ?? ".",
    hasRequirements: manifests.includes("requirements.txt"),
    hasPyproject: manifests.includes("pyproject.toml"),
    rspec: report.stack.testFrameworks.some((t) => t.name === "RSpec"),
    testFrameworks: report.stack.testFrameworks.map((t) => t.name),
  };
}

export function nodeRun(s: Stack, script: string): string {
  if (s.nodeManager === "pnpm") return `pnpm run --if-present ${script}`;
  if (s.nodeManager === "yarn") return `yarn run ${script}`;
  return `npm run ${script} --if-present`;
}

export function nodeInstall(s: Stack): string {
  if (s.nodeManager === "pnpm") return "pnpm install --frozen-lockfile";
  if (s.nodeManager === "yarn") return "yarn install";
  return s.hasNodeLockfile ? "npm ci" : "npm install";
}

export function workingDir(dir: string): string[] {
  return dir === "." ? [] : ["    defaults:", "      run:", `        working-directory: ${dir}`];
}
