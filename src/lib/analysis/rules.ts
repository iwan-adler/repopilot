import type {
  CheckStatus,
  Confidence,
  Evidence,
  FindingCategory,
  FindingKind,
  ScoreCategoryId,
  Severity,
} from "@/lib/reports/schema";
import { findPath, type AnalysisContext, type RepoFile } from "./context";
import { fetchedPackageJsons } from "./detect-stack";
import { allDependencies, parsePackageJson, type PackageJson } from "./manifests";
import {
  basename,
  extname,
  formatBytes,
  isBinaryExtension,
  isNonAuthoredPath,
  isRootFile,
  isSourceFile,
  isTestFile,
} from "./paths";
import { scanTextForSecrets, type SecretMatch } from "./secrets";
import {
  checksOutPullRequestHead,
  ciSystemFor,
  findScriptInjections,
  findTestCommand,
  findUnpinnedActions,
  isWorkflowPath,
  usesPullRequestTarget,
} from "./workflows";

export type FindingDraft = {
  severity: Severity;
  title: string;
  description: string;
  evidence: Evidence[];
  recommendation: string;
  confidence: Confidence;
};

export type RuleOutcome = {
  status: CheckStatus;
  /** One-line, human-readable result shown in the checks table. */
  summary: string;
  findings?: FindingDraft[];
};

export type Rule = {
  id: string;
  title: string;
  category: FindingCategory;
  scoreCategory: ScoreCategoryId;
  /** Relative importance inside its score category. 0 = informational (never scored). */
  weight: number;
  kind: FindingKind;
  /** Why this check matters. Copied into every finding the rule produces. */
  rationale: string;
  evaluate: (ctx: AnalysisContext) => RuleOutcome;
};

const MAX_EVIDENCE = 25;

// ---------- shared helpers ----------

function hasSourceCode(ctx: AnalysisContext): boolean {
  return ctx.files.some((f) => isSourceFile(f.path));
}

function hasEcosystem(ctx: AnalysisContext, prefix: string): boolean {
  return ctx.stack.ecosystems.some((e) => e.startsWith(prefix));
}

function usesLanguage(ctx: AnalysisContext, names: string[]): boolean {
  return ctx.stack.languages.some((l) => names.includes(l.name) && l.percent >= 5);
}

function isJsProject(ctx: AnalysisContext): boolean {
  return hasEcosystem(ctx, "JavaScript") || usesLanguage(ctx, ["JavaScript", "TypeScript"]);
}

function isPythonProject(ctx: AnalysisContext): boolean {
  return hasEcosystem(ctx, "Python") || usesLanguage(ctx, ["Python"]);
}

type RootPackage = { state: "absent" } | { state: "unfetched" } | { state: "invalid"; error: string } | { state: "ok"; pkg: PackageJson };

function rootPackage(ctx: AnalysisContext): RootPackage {
  if (!ctx.pathIndex.has("package.json")) return { state: "absent" };
  const text = ctx.contents.get("package.json");
  if (text === undefined) return { state: "unfetched" };
  const parsed = parsePackageJson(text);
  return parsed.ok ? { state: "ok", pkg: parsed.data } : { state: "invalid", error: parsed.error };
}

function textOf(ctx: AnalysisContext, path: string | null): string | null {
  if (!path) return null;
  return ctx.contents.get(path) ?? null;
}

function rootFile(ctx: AnalysisContext, pattern: RegExp): RepoFile | undefined {
  return ctx.files.find((f) => isRootFile(f.path) && pattern.test(f.path));
}

function anyFile(ctx: AnalysisContext, pattern: RegExp): RepoFile | undefined {
  return ctx.files.find((f) => !isNonAuthoredPath(f.path) && pattern.test(f.path));
}

const LOW_RISK_PATH_RE = /(^|\/)(tests?|__tests__|spec|specs|fixtures?|testdata|test-data|examples?|samples?|docs?|mocks?|__mocks__)(\/|$)/i;

function isLowRiskPath(path: string): boolean {
  return LOW_RISK_PATH_RE.test(path);
}

function pluralize(n: number, word: string, plural = `${word}s`): string {
  return `${n} ${n === 1 ? word : plural}`;
}

// ---------- rules ----------

export const RULES: Rule[] = [
  // ===== Structure / hygiene =====
  {
    id: "STR001",
    title: ".gitignore present",
    category: "structure",
    scoreCategory: "hygiene",
    weight: 1,
    kind: "observation",
    rationale:
      "A .gitignore keeps build output, dependencies, editor files, and local secrets out of version control.",
    evaluate(ctx) {
      const path = findPath(ctx, [".gitignore"]);
      if (path) return { status: "pass", summary: "Root .gitignore found." };
      return {
        status: "fail",
        summary: "No root .gitignore found.",
        findings: [
          {
            severity: "low",
            title: "No .gitignore at the repository root",
            description: "The repository has no .gitignore file at its root.",
            evidence: [{ detail: "No `.gitignore` entry exists at the root of the default branch." }],
            recommendation:
              "Add a .gitignore suited to your stack (see github.com/github/gitignore) that excludes dependencies, build output and .env files.",
            confidence: "high",
          },
        ],
      };
    },
  },
  {
    id: "STR002",
    title: "Project manifest recognized",
    category: "structure",
    scoreCategory: "hygiene",
    weight: 1,
    kind: "observation",
    rationale:
      "A manifest (package.json, pyproject.toml, go.mod, Cargo.toml…) declares dependencies and lets others build the project reproducibly.",
    evaluate(ctx) {
      if (!hasSourceCode(ctx)) return { status: "not_applicable", summary: "No source code detected." };
      const m = ctx.stack.manifests;
      if (m.length > 0) {
        return {
          status: "pass",
          summary: `${pluralize(m.length, "manifest")} found (${[...new Set(m.map((x) => x.ecosystem))].join(", ")}).`,
        };
      }
      return {
        status: "fail",
        summary: "Source code found but no recognized project manifest.",
        findings: [
          {
            severity: "low",
            title: "No recognized project manifest",
            description:
              "The repository contains source code, but RepoPilot did not find a recognized dependency/build manifest within three directory levels.",
            evidence: [{ detail: `${ctx.files.filter((f) => isSourceFile(f.path)).length} source files, 0 recognized manifests.` }],
            recommendation:
              "Declare dependencies and build metadata in your ecosystem's standard manifest (e.g. package.json, pyproject.toml, go.mod, Cargo.toml). If you use an unusual build system, this finding can be ignored.",
            confidence: "medium",
          },
        ],
      };
    },
  },

  // ===== Documentation =====
  {
    id: "DOC001",
    title: "README present",
    category: "documentation",
    scoreCategory: "hygiene",
    weight: 3,
    kind: "observation",
    rationale: "The README is the first thing users and contributors read; without it the project is hard to evaluate or use.",
    evaluate(ctx) {
      const readme = findReadme(ctx);
      if (readme) return { status: "pass", summary: `README found at ${readme}.` };
      return {
        status: "fail",
        summary: "No README found.",
        findings: [
          {
            severity: "high",
            title: "No README found",
            description: "No README file was found at the repository root, in .github/, or in docs/.",
            evidence: [{ detail: "Searched for README, README.md, README.rst, README.txt (case-insensitive)." }],
            recommendation:
              "Add a README.md describing what the project does, how to install and run it, and how to contribute.",
            confidence: "high",
          },
        ],
      };
    },
  },
  {
    id: "DOC002",
    title: "README completeness signals",
    category: "documentation",
    scoreCategory: "hygiene",
    weight: 2,
    kind: "heuristic",
    rationale:
      "READMEs that explain installation and usage with examples reduce onboarding time and support requests.",
    evaluate(ctx) {
      const readme = findReadme(ctx);
      if (!readme) return { status: "not_applicable", summary: "No README (covered by DOC001)." };
      const text = ctx.contents.get(readme);
      if (text === undefined) return { status: "unavailable", summary: "README content could not be retrieved." };
      const signals = readmeSignals(text);
      const missing = signals.filter((s) => !s.present);
      const present = signals.length - missing.length;
      const summary = `${present}/${signals.length} completeness signals present.`;
      if (missing.length === 0) return { status: "pass", summary };
      const status: CheckStatus = present >= 4 ? "pass" : present >= 2 ? "warn" : "fail";
      return {
        status,
        summary,
        findings: [
          {
            severity: status === "fail" ? "medium" : status === "warn" ? "low" : "info",
            title: "README is missing common sections",
            description: `The README at ${readme} lacks ${pluralize(missing.length, "common completeness signal")}.`,
            evidence: missing.map((s) => ({ path: readme, detail: `Missing: ${s.label}` })),
            recommendation:
              "Add the missing sections. A good minimum is: a one-paragraph description, installation steps, a usage example in a code block, and a license note.",
            confidence: "medium",
          },
        ],
      };
    },
  },
  {
    id: "DOC003",
    title: "License declared",
    category: "documentation",
    scoreCategory: "hygiene",
    weight: 2,
    kind: "observation",
    rationale:
      "Without a license, others have no legal permission to use, modify, or distribute the code, which blocks adoption and contributions.",
    evaluate(ctx) {
      const file = rootFile(ctx, /^(licen[sc]e|copying|unlicense)(\.[a-z]+|-[a-z]+)?$/i);
      const spdx = ctx.repository.license;
      if (file) return { status: "pass", summary: `License file ${file.path}${spdx ? ` (${spdx})` : ""}.` };
      if (spdx && spdx !== "NOASSERTION") return { status: "pass", summary: `GitHub reports license ${spdx}.` };
      return {
        status: "fail",
        summary: "No license file found.",
        findings: [
          {
            severity: "medium",
            title: "No license file",
            description: "No LICENSE/COPYING file exists at the repository root and GitHub did not detect a license.",
            evidence: [{ detail: "GitHub license metadata: none." }],
            recommendation:
              "Choose a license (choosealicense.com) and add it as LICENSE at the repository root. If the code is intentionally proprietary, state that explicitly in the README.",
            confidence: "high",
          },
        ],
      };
    },
  },
  {
    id: "DOC004",
    title: "Contribution guide",
    category: "documentation",
    scoreCategory: "hygiene",
    weight: 1,
    kind: "observation",
    rationale: "A contribution guide tells potential contributors how to set up, test, and submit changes.",
    evaluate(ctx) {
      const path = findPath(ctx, [
        "CONTRIBUTING.md", "CONTRIBUTING", "CONTRIBUTING.rst", "CONTRIBUTING.txt",
        ".github/CONTRIBUTING.md", "docs/CONTRIBUTING.md", "docs/contributing.md",
      ]);
      if (path) return { status: "pass", summary: `Contribution guide at ${path}.` };
      return {
        status: "warn",
        summary: "No contribution guide.",
        findings: [
          {
            severity: "low",
            title: "No contribution guide",
            description: "No CONTRIBUTING file was found in the root, .github/, or docs/.",
            evidence: [{ detail: "Searched CONTRIBUTING(.md|.rst|.txt) in root, .github/ and docs/." }],
            recommendation:
              "If you accept contributions, add CONTRIBUTING.md covering local setup, how to run tests, and the pull-request process. Solo or private-use projects can skip this. Organization-wide defaults from a separate .github repository are not checked, so this may not apply if your organization provides one.",
            confidence: "high",
          },
        ],
      };
    },
  },

  // ===== Testing =====
  {
    id: "TST001",
    title: "Automated tests present",
    category: "testing",
    scoreCategory: "testing",
    weight: 3,
    kind: "heuristic",
    rationale:
      "Automated tests catch regressions before users do. RepoPilot detects test files by naming and directory conventions; it never runs them.",
    evaluate(ctx) {
      if (!hasSourceCode(ctx)) return { status: "not_applicable", summary: "No source code detected." };
      const tests = ctx.files.filter((f) => isTestFile(f.path));
      if (tests.length > 0) {
        return { status: "pass", summary: `${pluralize(tests.length, "test file")} detected (not executed).` };
      }
      const inlineRust = [...ctx.contents].find(([p, t]) => p.endsWith(".rs") && /#\[cfg\(test\)\]/.test(t));
      if (inlineRust) {
        return { status: "pass", summary: `Inline Rust test module found in ${inlineRust[0]} (not executed).` };
      }
      return {
        status: "fail",
        summary: "No test files detected.",
        findings: [
          {
            severity: "high",
            title: "No automated tests detected",
            description:
              "RepoPilot found source code but no files matching common test naming or directory conventions." +
              (ctx.treeTruncated ? " The file tree was truncated, so tests may exist in unlisted paths." : ""),
            evidence: [
              {
                detail: `${ctx.files.filter((f) => isSourceFile(f.path)).length} source files; 0 match patterns such as *.test.ts, test_*.py, *_test.go, tests/ or __tests__/.`,
              },
            ],
            recommendation:
              "Add a test framework for your stack and start with tests for the most critical or most frequently changed code paths. Run them in CI.",
            confidence: ctx.treeTruncated ? "low" : "medium",
          },
        ],
      };
    },
  },
  {
    id: "TST002",
    title: "Test framework configured",
    category: "testing",
    scoreCategory: "testing",
    weight: 2,
    kind: "heuristic",
    rationale: "A configured test framework makes tests runnable by anyone with a single, documented command.",
    evaluate(ctx) {
      if (!hasSourceCode(ctx)) return { status: "not_applicable", summary: "No source code detected." };
      const fw = ctx.stack.testFrameworks;
      if (fw.length > 0) return { status: "pass", summary: `Detected: ${fw.map((f) => f.name).join(", ")}.` };
      const hasTests = ctx.files.some((f) => isTestFile(f.path));
      return {
        status: hasTests ? "warn" : "fail",
        summary: hasTests ? "Test files exist but no framework configuration was detected." : "No test framework detected.",
        findings: [
          {
            severity: hasTests ? "low" : "medium",
            title: hasTests ? "Test framework not identifiable" : "No test framework detected",
            description: hasTests
              ? "Test files exist, but RepoPilot could not identify the framework that runs them from manifests or config files."
              : "No test framework dependency or configuration file was found.",
            evidence: [{ detail: "Checked manifests and config files for Jest, Vitest, Mocha, Playwright, Cypress, pytest, JUnit, RSpec, PHPUnit and others." }],
            recommendation: hasTests
              ? "Declare the test runner explicitly (as a dev dependency or config file) so contributors know how to run the tests."
              : "Add a test runner for your stack (e.g. Vitest or Jest for JS/TS, pytest for Python) and document the test command.",
            confidence: "medium",
          },
        ],
      };
    },
  },
  {
    id: "TST003",
    title: "Test script in package.json",
    category: "testing",
    scoreCategory: "testing",
    weight: 1,
    kind: "observation",
    rationale: "`npm test` is the conventional entry point that contributors and CI systems expect.",
    evaluate(ctx) {
      const root = rootPackage(ctx);
      if (root.state === "absent") return { status: "not_applicable", summary: "No root package.json." };
      if (root.state === "unfetched") return { status: "unavailable", summary: "package.json could not be retrieved." };
      if (root.state === "invalid") return { status: "unavailable", summary: "package.json could not be parsed (see DEP003)." };
      const scripts = root.pkg.scripts ?? {};
      const testKey = Object.keys(scripts).find((k) => k === "test" || k.startsWith("test:"));
      const isDefault = testKey === "test" && /no test specified/.test(scripts.test ?? "");
      if (testKey && !isDefault) return { status: "pass", summary: `"${testKey}" script defined.` };
      return {
        status: "fail",
        summary: isDefault ? "Only npm's placeholder test script is defined." : "No test script defined.",
        findings: [
          {
            severity: "low",
            title: isDefault ? "Placeholder test script" : "No test script in package.json",
            description: isDefault
              ? 'package.json still contains npm\'s default `"test": "echo \\"Error: no test specified\\" && exit 1"`.'
              : "The root package.json has no `test` script.",
            evidence: [{ path: "package.json", detail: `scripts: ${Object.keys(scripts).join(", ") || "(none)"}` }],
            recommendation: 'Add a "test" script that runs your test framework, e.g. "test": "vitest run".',
            confidence: "high",
          },
        ],
      };
    },
  },
  {
    id: "TST004",
    title: "CI runs tests",
    category: "testing",
    scoreCategory: "testing",
    weight: 2,
    kind: "heuristic",
    rationale: "Tests only protect the main branch if they run automatically on every change.",
    evaluate(ctx) {
      const ciFiles = ctx.files.filter((f) => ciSystemFor(f.path));
      if (ciFiles.length === 0) return { status: "not_applicable", summary: "No CI configuration (covered by DX003)." };
      const fetched = ciFiles.filter((f) => ctx.contents.has(f.path));
      if (fetched.length === 0) return { status: "unavailable", summary: "CI configuration could not be retrieved." };
      for (const f of fetched) {
        const line = findTestCommand(ctx.contents.get(f.path)!);
        if (line) return { status: "pass", summary: `Test command found in ${f.path}:${line}.` };
      }
      return {
        status: "warn",
        summary: "CI exists but no recognizable test command was found.",
        findings: [
          {
            severity: "medium",
            title: "CI does not appear to run tests",
            description: `${pluralize(fetched.length, "CI configuration file")} inspected; none contains a recognizable test command.`,
            evidence: fetched.slice(0, MAX_EVIDENCE).map((f) => ({ path: f.path, detail: "No test command matched (e.g. npm test, pytest, go test, cargo test)." })),
            recommendation:
              "Add a step that runs your test suite on every push and pull request. If tests run via a custom script or make target, this may be a false positive.",
            confidence: "medium",
          },
        ],
      };
    },
  },

  // ===== Developer experience (maintainability) =====
  {
    id: "DX001",
    title: "Linter configured",
    category: "developer-experience",
    scoreCategory: "maintainability",
    weight: 2,
    kind: "heuristic",
    rationale: "Linters catch bugs and enforce consistent conventions automatically, which keeps reviews focused on logic.",
    evaluate(ctx) {
      const checks: { applies: boolean; found: string | null; ecosystem: string }[] = [];
      const pkgs = fetchedPackageJsons(ctx);
      if (isJsProject(ctx)) {
        const file = anyFile(ctx, /(^|\/)(eslint\.config\.[cm]?[jt]s|\.eslintrc(\.(js|cjs|json|ya?ml))?|biome\.jsonc?|\.oxlintrc\.json|deno\.jsonc?|\.jshintrc|tslint\.json)$/);
        const dep = pkgs.find(({ pkg }) => {
          const d = allDependencies(pkg);
          return d.eslint || d["@biomejs/biome"] || d.oxlint || d.xo || d.standard || pkg.eslintConfig;
        });
        checks.push({ applies: true, ecosystem: "JavaScript/TypeScript", found: file?.path ?? (dep ? `lint dependency in ${dep.path}` : null) });
      }
      if (isPythonProject(ctx)) {
        const file = anyFile(ctx, /(^|\/)(ruff\.toml|\.ruff\.toml|\.flake8|\.pylintrc|pylintrc)$/);
        const pyproject = textOf(ctx, findPath(ctx, ["pyproject.toml"]));
        const setupCfg = textOf(ctx, findPath(ctx, ["setup.cfg", "tox.ini"]));
        const inPyproject = pyproject && /^\s*\[tool\.(ruff|pylint|flake8)/m.test(pyproject);
        const inSetup = setupCfg && /^\s*\[flake8\]/m.test(setupCfg);
        checks.push({
          applies: true,
          ecosystem: "Python",
          found: file?.path ?? (inPyproject ? "pyproject.toml [tool.*] lint section" : inSetup ? "[flake8] section" : null),
        });
      }
      if (usesLanguage(ctx, ["Ruby"])) {
        checks.push({ applies: true, ecosystem: "Ruby", found: anyFile(ctx, /(^|\/)\.(rubocop|standard)\.ya?ml$/)?.path ?? null });
      }
      if (usesLanguage(ctx, ["PHP"])) {
        checks.push({ applies: true, ecosystem: "PHP", found: anyFile(ctx, /(^|\/)(phpcs\.xml(\.dist)?|phpstan\.neon(\.dist)?|psalm\.xml)$/)?.path ?? null });
      }
      if (checks.length === 0) return { status: "not_applicable", summary: "No ecosystem with a linter check (JS/TS, Python, Ruby, PHP)." };
      const missing = checks.filter((c) => !c.found);
      if (missing.length === 0) return { status: "pass", summary: `Linter configuration: ${checks.map((c) => c.found).join("; ")}.` };
      return {
        status: "fail",
        summary: `No linter configuration for ${missing.map((m) => m.ecosystem).join(", ")}.`,
        findings: [
          {
            severity: "medium",
            title: `No linter configured for ${missing.map((m) => m.ecosystem).join(", ")}`,
            description: "No linter configuration file or linter dependency was found for the listed ecosystem(s).",
            evidence: missing.map((m) => ({ detail: `${m.ecosystem}: no linter configuration detected.` })),
            recommendation:
              "Add a linter (ESLint or Biome for JS/TS, Ruff for Python, RuboCop for Ruby, PHPStan for PHP) and run it in CI.",
            confidence: "medium",
          },
        ],
      };
    },
  },
  {
    id: "DX002",
    title: "Formatter configured",
    category: "developer-experience",
    scoreCategory: "maintainability",
    weight: 1,
    kind: "heuristic",
    rationale: "An automatic formatter removes style debates and keeps diffs focused on real changes.",
    evaluate(ctx) {
      const pkgs = fetchedPackageJsons(ctx);
      const missing: string[] = [];
      const found: string[] = [];
      let applicable = false;
      if (isJsProject(ctx)) {
        applicable = true;
        const file = anyFile(ctx, /(^|\/)(\.prettierrc(\.(json|ya?ml|js|cjs|mjs|toml|json5))?|prettier\.config\.[cm]?[jt]s|biome\.jsonc?|dprint\.jsonc?|deno\.jsonc?|tsfmt\.json)$/);
        const dep = pkgs.find(({ pkg }) => {
          const d = allDependencies(pkg);
          return d.prettier || d["@biomejs/biome"] || d.dprint || pkg.prettier;
        });
        if (file || dep) found.push(file?.path ?? `formatter dependency in ${dep!.path}`);
        else missing.push("JavaScript/TypeScript");
      }
      if (isPythonProject(ctx)) {
        applicable = true;
        const pyproject = textOf(ctx, findPath(ctx, ["pyproject.toml"])) ?? "";
        const file = anyFile(ctx, /(^|\/)(ruff\.toml|\.ruff\.toml|\.style\.yapf)$/);
        if (file || /^\s*\[tool\.(black|ruff|yapf|isort)/m.test(pyproject)) found.push(file?.path ?? "pyproject.toml formatter section");
        else missing.push("Python");
      }
      if (!applicable) return { status: "not_applicable", summary: "Formatter check applies to JS/TS and Python." };
      if (missing.length === 0) return { status: "pass", summary: `Formatter configuration: ${found.join("; ")}.` };
      return {
        status: "warn",
        summary: `No formatter configuration for ${missing.join(", ")}.`,
        findings: [
          {
            severity: "low",
            title: `No formatter configured for ${missing.join(", ")}`,
            description: "No formatter configuration (e.g. Prettier, Biome, Black, Ruff) was detected.",
            evidence: missing.map((m) => ({ detail: `${m}: no formatter configuration detected.` })),
            recommendation: "Adopt an automatic formatter (Prettier or Biome for JS/TS; Ruff or Black for Python) and enforce it in CI or a pre-commit hook.",
            confidence: "medium",
          },
        ],
      };
    },
  },
  {
    id: "DX003",
    title: "Continuous integration configured",
    category: "developer-experience",
    scoreCategory: "maintainability",
    weight: 2,
    kind: "observation",
    rationale: "CI runs builds, linters and tests on every change so problems are caught before merging.",
    evaluate(ctx) {
      if (!hasSourceCode(ctx)) return { status: "not_applicable", summary: "No source code detected." };
      const ci = ctx.files.map((f) => ({ path: f.path, system: ciSystemFor(f.path) })).filter((x) => x.system);
      if (ci.length > 0) {
        const systems = [...new Set(ci.map((c) => c.system))];
        return { status: "pass", summary: `${systems.join(", ")} (${pluralize(ci.length, "config file")}).` };
      }
      return {
        status: "fail",
        summary: "No CI configuration found.",
        findings: [
          {
            severity: "medium",
            title: "No continuous integration configured",
            description: "No configuration for GitHub Actions, GitLab CI, CircleCI, Travis, Azure Pipelines, Jenkins, or similar systems was found.",
            evidence: [{ detail: "No .github/workflows/*.yml or other recognized CI configuration file." }],
            recommendation:
              "Add a GitHub Actions workflow (.github/workflows/ci.yml) that installs dependencies, lints, and runs tests on push and pull_request. It's free for public repositories.",
            confidence: "high",
          },
        ],
      };
    },
  },
  {
    id: "DX004",
    title: "Standard npm scripts",
    category: "developer-experience",
    scoreCategory: "maintainability",
    weight: 1,
    kind: "observation",
    rationale: "Conventional scripts (build/dev/start, lint) give contributors a predictable way to work on the project.",
    evaluate(ctx) {
      const root = rootPackage(ctx);
      if (root.state === "absent") return { status: "not_applicable", summary: "No root package.json." };
      if (root.state !== "ok") return { status: "unavailable", summary: "package.json not available for parsing." };
      const keys = Object.keys(root.pkg.scripts ?? {});
      const hasRun = keys.some((k) => /^(build|dev|start|serve|compile|watch)([:-]|$)/.test(k));
      const hasLint = keys.some((k) => /^(lint|eslint|stylelint|biome|check|format|prettier|typecheck|tsc)([:-]|$)/.test(k));
      if (hasRun && hasLint) return { status: "pass", summary: `Scripts: ${keys.slice(0, 8).join(", ")}${keys.length > 8 ? "…" : ""}.` };
      const missing = [!hasRun && "build/dev/start", !hasLint && "lint/check"].filter(Boolean) as string[];
      return {
        status: keys.length === 0 ? "fail" : "warn",
        summary: `Missing script types: ${missing.join(", ")}.`,
        findings: [
          {
            severity: "low",
            title: "Conventional npm scripts missing",
            description: `The root package.json defines no ${missing.join(" or ")} script.`,
            evidence: [{ path: "package.json", detail: `Defined scripts: ${keys.slice(0, 20).join(", ") || "(none)"}${keys.length > 20 ? ` (+${keys.length - 20} more)` : ""}` }],
            recommendation: 'Add scripts such as "dev", "build" and "lint" so contributors can run common tasks with npm run <name>.',
            confidence: "high",
          },
        ],
      };
    },
  },

  // ===== Dependencies (hygiene) =====
  {
    id: "DEP001",
    title: "Lockfile committed",
    category: "dependencies",
    scoreCategory: "hygiene",
    weight: 2,
    kind: "observation",
    rationale: "Lockfiles pin exact dependency versions so every install, CI run and deployment uses the same dependency tree.",
    evaluate(ctx) {
      const issues: Evidence[] = [];
      let applicable = false;
      let appLike = false;
      const root = rootPackage(ctx);
      if (root.state === "ok") {
        const deps = allDependencies(root.pkg);
        if (Object.keys(deps).length > 0) {
          applicable = true;
          appLike = root.pkg.private === true;
          const lock = findPath(ctx, ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb"]);
          if (!lock) issues.push({ path: "package.json", detail: `${Object.keys(deps).length} dependencies declared but no npm/Yarn/pnpm/Bun lockfile at the root.` });
        }
      }
      if (findPath(ctx, ["Pipfile"])) {
        applicable = true;
        appLike = true;
        if (!findPath(ctx, ["Pipfile.lock"])) issues.push({ path: "Pipfile", detail: "Pipfile without Pipfile.lock." });
      }
      const pyproject = textOf(ctx, findPath(ctx, ["pyproject.toml"]));
      if (pyproject && /^\s*\[tool\.poetry\]/m.test(pyproject)) {
        applicable = true;
        if (!findPath(ctx, ["poetry.lock"])) issues.push({ path: "pyproject.toml", detail: "Poetry project without poetry.lock." });
      }
      if (!applicable) return { status: "not_applicable", summary: "No npm/Pipenv/Poetry dependencies declared at the root." };
      if (issues.length === 0) return { status: "pass", summary: "Lockfile present for declared dependencies." };
      return {
        status: "fail",
        summary: "Dependencies declared without a lockfile.",
        findings: [
          {
            severity: appLike ? "medium" : "low",
            title: "Missing dependency lockfile",
            description:
              "Dependencies are declared but no corresponding lockfile is committed." +
              (appLike ? "" : " Some published libraries intentionally omit lockfiles; applications should commit them."),
            evidence: issues,
            recommendation: "Commit the lockfile your package manager generates (e.g. package-lock.json, pnpm-lock.yaml, poetry.lock) and use frozen installs in CI (npm ci).",
            confidence: appLike ? "high" : "medium",
          },
        ],
      };
    },
  },
  {
    id: "DEP002",
    title: "Single JavaScript package manager",
    category: "dependencies",
    scoreCategory: "hygiene",
    weight: 1,
    kind: "observation",
    rationale: "Multiple lockfiles from different package managers drift apart and make installs non-deterministic.",
    evaluate(ctx) {
      const locks = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb"]
        .map((p) => findPath(ctx, [p]))
        .filter((p): p is string => p !== null);
      const distinct = new Set(locks.map((l) => (l.startsWith("bun.") ? "bun" : l)));
      if (locks.length === 0) return { status: "not_applicable", summary: "No JavaScript lockfiles at the root." };
      if (distinct.size === 1) return { status: "pass", summary: `Single lockfile: ${locks.join(", ")}.` };
      return {
        status: "fail",
        summary: `Conflicting lockfiles: ${locks.join(", ")}.`,
        findings: [
          {
            severity: "medium",
            title: "Conflicting package-manager lockfiles",
            description: `The repository root contains lockfiles for ${distinct.size} different package managers.`,
            evidence: locks.map((l) => ({ path: l, detail: "Lockfile at repository root." })),
            recommendation:
              'Pick one package manager, delete the other lockfiles, and declare your choice with the "packageManager" field in package.json.',
            confidence: "high",
          },
        ],
      };
    },
  },
  {
    id: "DEP003",
    title: "package.json files parse",
    category: "dependencies",
    scoreCategory: "hygiene",
    weight: 2,
    kind: "observation",
    rationale: "An invalid package.json breaks every install and tool that reads it.",
    evaluate(ctx) {
      const inTree = ctx.files.filter((f) => basename(f.path) === "package.json" && !isNonAuthoredPath(f.path));
      if (inTree.length === 0) return { status: "not_applicable", summary: "No package.json files." };
      const fetched = inTree.filter((f) => ctx.contents.has(f.path));
      if (fetched.length === 0) return { status: "unavailable", summary: "package.json content could not be retrieved." };
      const invalid = fetched
        .map((f) => ({ path: f.path, result: parsePackageJson(ctx.contents.get(f.path)!) }))
        .filter((x) => !x.result.ok);
      if (invalid.length === 0) return { status: "pass", summary: `${pluralize(fetched.length, "package.json file")} parsed successfully.` };
      return {
        status: "fail",
        summary: `${pluralize(invalid.length, "package.json file")} failed to parse.`,
        findings: [
          {
            severity: "high",
            title: "Invalid package.json",
            description: `${pluralize(invalid.length, "package.json file")} could not be parsed as a valid manifest.`,
            evidence: invalid.map((x) => ({ path: x.path, detail: x.result.ok ? "" : x.result.error })),
            recommendation: "Fix the JSON syntax (e.g. trailing commas, comments) and validate with `npm pkg get name`.",
            confidence: "high",
          },
        ],
      };
    },
  },
  {
    id: "DEP004",
    title: "Automated dependency updates",
    category: "dependencies",
    scoreCategory: "hygiene",
    weight: 1,
    kind: "observation",
    rationale: "Dependabot or Renovate keep dependencies current and surface security fixes as pull requests.",
    evaluate(ctx) {
      if (ctx.stack.manifests.length === 0) return { status: "not_applicable", summary: "No dependency manifests." };
      const path = findPath(ctx, [
        ".github/dependabot.yml", ".github/dependabot.yaml", "renovate.json", "renovate.json5",
        ".renovaterc", ".renovaterc.json", ".github/renovate.json", ".github/renovate.json5", ".gitlab/renovate.json",
      ]);
      const root = rootPackage(ctx);
      if (path) return { status: "pass", summary: `Configured via ${path}.` };
      if (root.state === "ok" && root.pkg.renovate !== undefined) return { status: "pass", summary: 'Renovate configured in package.json "renovate" key.' };
      return {
        status: "warn",
        summary: "No Dependabot or Renovate configuration.",
        findings: [
          {
            severity: "low",
            title: "No automated dependency updates",
            description: "No Dependabot or Renovate configuration was found.",
            evidence: [{ detail: "Checked .github/dependabot.yml and common Renovate config locations." }],
            recommendation: "Add .github/dependabot.yml (free on GitHub) to receive update and security pull requests for your dependencies.",
            confidence: "high",
          },
        ],
      };
    },
  },
  {
    id: "DEP005",
    title: "No unbounded dependency versions",
    category: "dependencies",
    scoreCategory: "hygiene",
    weight: 1,
    kind: "observation",
    rationale: 'Versions like "*" or "latest" accept any future release, including breaking or malicious ones.',
    evaluate(ctx) {
      const pkgs = fetchedPackageJsons(ctx);
      if (pkgs.length === 0) return { status: "not_applicable", summary: "No parsed package.json files." };
      const evidence: Evidence[] = [];
      for (const { path, pkg } of pkgs) {
        for (const [section, deps] of [
          ["dependencies", pkg.dependencies],
          ["devDependencies", pkg.devDependencies],
          ["optionalDependencies", pkg.optionalDependencies],
        ] as const) {
          for (const [name, version] of Object.entries(deps ?? {})) {
            if (["*", "latest", "", "x", "X"].includes(version.trim())) {
              evidence.push({ path, detail: `${section}: "${name}": "${version}"` });
            }
          }
        }
      }
      if (evidence.length === 0) return { status: "pass", summary: "All declared npm versions are bounded." };
      return {
        status: "fail",
        summary: `${pluralize(evidence.length, "unbounded version specifier")}.`,
        findings: [
          {
            severity: "medium",
            title: "Unbounded dependency versions",
            description: `${pluralize(evidence.length, "dependency", "dependencies")} accept any version.`,
            evidence: evidence.slice(0, MAX_EVIDENCE),
            recommendation: 'Replace "*" / "latest" with a semver range (e.g. "^4.2.0") and rely on the lockfile plus Dependabot for updates.',
            confidence: "high",
          },
        ],
      };
    },
  },

  // ===== Security signals =====
  {
    id: "SEC001",
    title: "No credential-like strings in scanned files",
    category: "security",
    scoreCategory: "security",
    weight: 4,
    kind: "heuristic",
    rationale:
      "Credentials committed to a public repository can be harvested by automated scanners within minutes. Removing them from the latest commit is not enough; they remain in Git history.",
    evaluate(ctx) {
      if (ctx.contents.size === 0) return { status: "unavailable", summary: "No file contents were available to scan." };
      const matches: SecretMatch[] = [];
      for (const [path, text] of ctx.contents) matches.push(...scanTextForSecrets(path, text));
      const scanned = `${pluralize(ctx.contents.size, "file")} scanned`;
      if (matches.length === 0) return { status: "pass", summary: `${scanned}; no credential patterns matched.` };

      const byPattern = new Map<string, SecretMatch[]>();
      for (const m of matches) byPattern.set(m.patternId, [...(byPattern.get(m.patternId) ?? []), m]);

      let strong = false;
      const findings: FindingDraft[] = [];
      for (const group of byPattern.values()) {
        const real = group.filter((m) => !isLowRiskPath(m.path));
        const allLowRisk = real.length === 0;
        const first = group[0];
        const confidence: Confidence = allLowRisk ? "low" : first.confidence;
        const severity: Severity = allLowRisk ? "low" : first.severity;
        if (!allLowRisk && first.confidence !== "low") strong = true;
        findings.push({
          severity,
          title: `Possible ${first.label.toLowerCase()} committed`,
          description:
            `${pluralize(group.length, "match", "matches")} for the "${first.label}" pattern.` +
            (allLowRisk ? " All matches are in test, fixture, example or docs paths and may be intentional placeholders." : "") +
            " Values are redacted; RepoPilot did not verify whether they are live credentials.",
          evidence: group.slice(0, MAX_EVIDENCE).map((m) => ({ path: m.path, line: m.line, detail: `Matched value: ${m.redacted}` })),
          recommendation:
            "If this is a real credential: revoke/rotate it immediately at the provider, remove it from the code, load it from an environment variable or secret manager, and consider purging Git history. If it is a placeholder or test value, make that obvious (e.g. 'EXAMPLE') to avoid false positives.",
          confidence,
        });
      }
      return {
        status: strong ? "fail" : "warn",
        summary: `${scanned}; ${pluralize(matches.length, "credential-like match", "credential-like matches")}.`,
        findings,
      };
    },
  },
  {
    id: "SEC002",
    title: "No committed .env files",
    category: "security",
    scoreCategory: "security",
    weight: 3,
    kind: "observation",
    rationale: ".env files usually hold API keys, database URLs and other secrets that should never be committed.",
    evaluate(ctx) {
      const envFiles = ctx.files.filter((f) => {
        const base = basename(f.path).toLowerCase();
        // Empty files cannot contain secrets.
        if (!/^\.env(\.[a-z0-9_-]+)*$/.test(base) || f.size === 0) return false;
        return !/\.(example|sample|template|tpl|dist|defaults?|schema|ci|test)$/.test(base) && !isNonAuthoredPath(f.path);
      });
      if (envFiles.length === 0) return { status: "pass", summary: "No .env files committed." };
      const allLowRisk = envFiles.every((f) => isLowRiskPath(f.path));
      return {
        status: allLowRisk ? "warn" : "fail",
        summary: `${pluralize(envFiles.length, ".env file")} committed.`,
        findings: [
          {
            severity: allLowRisk ? "low" : "high",
            title: "Environment file committed",
            description: `${pluralize(envFiles.length, "environment file")} that commonly contain secrets ${envFiles.length === 1 ? "is" : "are"} tracked in Git. RepoPilot did not inspect whether they contain real values.`,
            evidence: envFiles.slice(0, MAX_EVIDENCE).map((f) => ({ path: f.path, detail: `${formatBytes(f.size)} file tracked in Git.` })),
            recommendation:
              "Remove the file from Git (git rm --cached), add it to .gitignore, rotate any secrets it contained, and commit a .env.example with placeholder values instead.",
            confidence: allLowRisk ? "low" : "medium",
          },
        ],
      };
    },
  },
  {
    id: "SEC003",
    title: "No committed private key files",
    category: "security",
    scoreCategory: "security",
    weight: 2,
    kind: "heuristic",
    rationale: "Private keys and keystores grant access to servers, signing identities, or TLS endpoints.",
    evaluate(ctx) {
      const keyFiles = ctx.files.filter((f) => {
        if (isNonAuthoredPath(f.path)) return false;
        const base = basename(f.path).toLowerCase();
        return /^id_(rsa|dsa|ecdsa|ed25519)$/.test(base) || ["pem", "key", "p12", "pfx", "jks", "keystore"].includes(extname(f.path));
      });
      if (keyFiles.length === 0) return { status: "pass", summary: "No private-key-like files committed." };
      const real = keyFiles.filter((f) => !isLowRiskPath(f.path));
      return {
        status: real.length > 0 ? "fail" : "warn",
        summary: `${pluralize(keyFiles.length, "key-like file")} committed.`,
        findings: [
          {
            severity: real.length > 0 ? "high" : "low",
            title: "Key or certificate files committed",
            description:
              `${pluralize(keyFiles.length, "file")} with key/keystore names or extensions ${keyFiles.length === 1 ? "is" : "are"} tracked. ` +
              "Some may be public certificates or test fixtures; RepoPilot identifies them by name only.",
            evidence: keyFiles.slice(0, MAX_EVIDENCE).map((f) => ({ path: f.path, detail: isLowRiskPath(f.path) ? "In a test/fixture/example path." : "Key-like file name or extension." })),
            recommendation: "Confirm these files contain no private key material. Remove real keys from the repository, rotate them, and load them from a secret store at runtime.",
            confidence: real.length > 0 ? "medium" : "low",
          },
        ],
      };
    },
  },
  {
    id: "SEC004",
    title: "Security policy published",
    category: "security",
    scoreCategory: "security",
    weight: 1,
    kind: "observation",
    rationale: "A SECURITY.md tells researchers how to report vulnerabilities privately instead of opening public issues.",
    evaluate(ctx) {
      if (!hasSourceCode(ctx)) return { status: "not_applicable", summary: "No source code detected." };
      const path = findPath(ctx, ["SECURITY.md", ".github/SECURITY.md", "docs/SECURITY.md", "SECURITY", "SECURITY.rst"]);
      if (path) return { status: "pass", summary: `Security policy at ${path}.` };
      return {
        status: "warn",
        summary: "No SECURITY.md.",
        findings: [
          {
            severity: "low",
            title: "No security policy",
            description: "No SECURITY.md was found in the root, .github/ or docs/.",
            evidence: [{ detail: "Searched SECURITY.md in root, .github/ and docs/." }],
            recommendation: "Add SECURITY.md describing supported versions and how to report vulnerabilities (GitHub private vulnerability reporting is free). Organization-wide defaults from a separate .github repository are not checked, so this may not apply if your organization provides one.",
            confidence: "high",
          },
        ],
      };
    },
  },
  {
    id: "SEC005",
    title: "Safe use of pull_request_target",
    category: "security",
    scoreCategory: "security",
    weight: 2,
    kind: "heuristic",
    rationale:
      "pull_request_target workflows run with repository secrets and write permissions; checking out untrusted PR code in them lets any contributor execute code with those privileges.",
    evaluate(ctx) {
      const wfs = ctx.files.filter((f) => isWorkflowPath(f.path));
      if (wfs.length === 0) return { status: "not_applicable", summary: "No GitHub Actions workflows." };
      const fetched = wfs.filter((f) => ctx.contents.has(f.path));
      if (fetched.length === 0) return { status: "unavailable", summary: "Workflow files could not be retrieved." };
      const risky: Evidence[] = [];
      const prt: Evidence[] = [];
      for (const f of fetched) {
        const text = ctx.contents.get(f.path)!;
        if (!usesPullRequestTarget(text)) continue;
        const line = checksOutPullRequestHead(text);
        if (line) risky.push({ path: f.path, line, detail: "pull_request_target workflow checks out the pull request head ref." });
        else prt.push({ path: f.path, detail: "Workflow is triggered by pull_request_target." });
      }
      if (risky.length === 0 && prt.length === 0) return { status: "pass", summary: `${pluralize(fetched.length, "workflow")} checked; no pull_request_target usage.` };
      if (risky.length > 0) {
        return {
          status: "fail",
          summary: "pull_request_target checks out untrusted code.",
          findings: [
            {
              severity: "high",
              title: "pull_request_target runs untrusted pull-request code",
              description: "A workflow triggered by pull_request_target explicitly checks out the pull request's head commit.",
              evidence: risky,
              recommendation:
                "Use the pull_request trigger for building/testing PR code. If pull_request_target is required, never check out or execute the PR head, or split the job using workflow_run with minimal permissions.",
              confidence: "medium",
            },
          ],
        };
      }
      return {
        status: "warn",
        summary: "pull_request_target is used; review its steps.",
        findings: [
          {
            severity: "medium",
            title: "Workflow uses pull_request_target",
            description: "pull_request_target is used. No explicit checkout of the PR head was found, but the workflow should be reviewed.",
            evidence: prt,
            recommendation: "Confirm the workflow never runs code from the pull request and declares minimal `permissions:`.",
            confidence: "low",
          },
        ],
      };
    },
  },
  {
    id: "SEC006",
    title: "No script injection in workflows",
    category: "security",
    scoreCategory: "security",
    weight: 2,
    kind: "heuristic",
    rationale:
      "Interpolating attacker-controlled values (issue titles, PR bodies, branch names) directly into run: scripts allows shell command injection in CI.",
    evaluate(ctx) {
      const wfs = ctx.files.filter((f) => isWorkflowPath(f.path));
      if (wfs.length === 0) return { status: "not_applicable", summary: "No GitHub Actions workflows." };
      const fetched = wfs.filter((f) => ctx.contents.has(f.path));
      if (fetched.length === 0) return { status: "unavailable", summary: "Workflow files could not be retrieved." };
      const evidence: Evidence[] = [];
      for (const f of fetched) {
        for (const line of findScriptInjections(ctx.contents.get(f.path)!)) {
          evidence.push({ path: f.path, line, detail: "Untrusted github.event expression interpolated into a script." });
        }
      }
      if (evidence.length === 0) return { status: "pass", summary: `${pluralize(fetched.length, "workflow")} checked; no untrusted interpolation in scripts.` };
      return {
        status: "fail",
        summary: `${pluralize(evidence.length, "possible script injection")}.`,
        findings: [
          {
            severity: "high",
            title: "Possible script injection in GitHub Actions",
            description: "Attacker-controllable event fields are interpolated with ${{ }} inside run: or script: blocks.",
            evidence: evidence.slice(0, MAX_EVIDENCE),
            recommendation:
              "Pass the value through an environment variable (env: TITLE: ${{ github.event.issue.title }}) and reference it as \"$TITLE\" in the script instead of interpolating it directly.",
            confidence: "medium",
          },
        ],
      };
    },
  },
  {
    id: "SEC007",
    title: "Third-party actions pinned to commits",
    category: "security",
    scoreCategory: "security",
    weight: 1,
    kind: "observation",
    rationale:
      "Tags and branches of third-party actions can be moved to malicious code; pinning to a full commit SHA makes the referenced code immutable.",
    evaluate(ctx) {
      const wfs = ctx.files.filter((f) => isWorkflowPath(f.path));
      if (wfs.length === 0) return { status: "not_applicable", summary: "No GitHub Actions workflows." };
      const fetched = wfs.filter((f) => ctx.contents.has(f.path));
      if (fetched.length === 0) return { status: "unavailable", summary: "Workflow files could not be retrieved." };
      const evidence: Evidence[] = [];
      for (const f of fetched) {
        for (const u of findUnpinnedActions(ctx.contents.get(f.path)!)) {
          evidence.push({ path: f.path, line: u.line, detail: `uses: ${u.ref}` });
        }
      }
      if (evidence.length === 0) return { status: "pass", summary: "All third-party actions are pinned to commit SHAs (or none are used)." };
      return {
        status: "warn",
        summary: `${pluralize(evidence.length, "third-party action reference")} not pinned to a SHA.`,
        findings: [
          {
            severity: "low",
            title: "Third-party actions referenced by mutable tags",
            description: `${pluralize(evidence.length, "third-party action reference")} use a tag or branch instead of a full commit SHA.`,
            evidence: evidence.slice(0, MAX_EVIDENCE),
            recommendation: "Pin third-party actions to a full-length commit SHA (with the version in a comment) and let Dependabot update them.",
            confidence: "high",
          },
        ],
      };
    },
  },

  // ===== Maintainability =====
  {
    id: "MNT001",
    title: "No oversized source files",
    category: "maintainability",
    scoreCategory: "maintainability",
    weight: 2,
    kind: "heuristic",
    rationale:
      "Very large source files are harder to review, test and change safely. Size is measured in bytes from the Git tree; generated, vendored, minified and test files are excluded.",
    evaluate(ctx) {
      const sources = ctx.files.filter((f) => isSourceFile(f.path) && !isTestFile(f.path));
      if (sources.length === 0) return { status: "not_applicable", summary: "No source files." };
      const limit = ctx.options.oversizedFileBytes;
      const big = sources.filter((f) => f.size > limit).sort((a, b) => b.size - a.size);
      if (big.length === 0) return { status: "pass", summary: `No source file exceeds ${formatBytes(limit)}.` };
      const severe = big.some((f) => f.size > limit * 3);
      return {
        status: severe ? "fail" : "warn",
        summary: `${pluralize(big.length, "source file")} larger than ${formatBytes(limit)}.`,
        findings: [
          {
            severity: severe ? "medium" : "low",
            title: "Oversized source files",
            description: `${pluralize(big.length, "source file")} exceed the ${formatBytes(limit)} threshold. Some may be generated code that should be excluded or marked as generated.`,
            evidence: big.slice(0, 10).map((f) => ({ path: f.path, detail: formatBytes(f.size) })),
            recommendation:
              "Consider splitting the largest files into cohesive modules. If a file is generated, move it to a generated/ directory or mark it with linguist-generated in .gitattributes.",
            confidence: "medium",
          },
        ],
      };
    },
  },
  {
    id: "MNT002",
    title: "No committed dependency or cache directories",
    category: "maintainability",
    scoreCategory: "maintainability",
    weight: 2,
    kind: "observation",
    rationale: "Committed dependencies, virtualenvs and caches bloat the repository and cause platform-specific conflicts.",
    evaluate(ctx) {
      const heavy = new Map<string, number>();
      const light = new Map<string, number>();
      const allPaths = [...ctx.files.map((f) => f.path), ...ctx.directories];
      for (const p of allPaths) {
        // Dependency trees inside test fixtures are usually intentional.
        if (isLowRiskPath(p)) continue;
        const segs = p.split("/");
        const heavyIdx = segs.findIndex((s) => ["node_modules", "bower_components"].includes(s));
        if (heavyIdx !== -1) {
          const key = segs.slice(0, heavyIdx + 1).join("/");
          heavy.set(key, (heavy.get(key) ?? 0) + 1);
          continue;
        }
        if (basename(p) === "pyvenv.cfg") heavy.set(segs.slice(0, -1).join("/") || ".", 1);
        const lightIdx = segs.findIndex((s) => ["__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache"].includes(s));
        if (lightIdx !== -1) {
          const key = segs.slice(0, lightIdx + 1).join("/");
          light.set(key, (light.get(key) ?? 0) + 1);
        } else if (/(^|\/)(\.DS_Store|Thumbs\.db)$/.test(p) || /\.pyc$/.test(p)) {
          light.set(p, 1);
        }
      }
      if (heavy.size === 0 && light.size === 0) return { status: "pass", summary: "No dependency, virtualenv or cache directories committed." };
      const isHeavy = heavy.size > 0;
      const evidence = [...heavy.keys(), ...light.keys()].slice(0, MAX_EVIDENCE).map((p) => ({ path: p, detail: heavy.has(p) ? "Dependency/virtualenv directory tracked in Git." : "Cache or OS metadata file tracked in Git." }));
      return {
        status: isHeavy ? "fail" : "warn",
        summary: `${pluralize(heavy.size + light.size, "unwanted path")} committed.`,
        findings: [
          {
            severity: isHeavy ? "medium" : "low",
            title: isHeavy ? "Dependency directories committed" : "Cache or OS metadata files committed",
            description: isHeavy
              ? "Installed dependencies or a virtual environment are tracked in Git."
              : "Generated caches or OS metadata files are tracked in Git.",
            evidence,
            recommendation: "Remove them with git rm -r --cached <path>, add the patterns to .gitignore, and reinstall dependencies from the manifest.",
            confidence: "high",
          },
        ],
      };
    },
  },
  {
    id: "MNT003",
    title: "No very large committed files",
    category: "maintainability",
    scoreCategory: "maintainability",
    weight: 1,
    kind: "observation",
    rationale:
      "Large files slow every clone and fetch. GitHub warns above 50 MB and rejects files over 100 MB; Git LFS stores large assets efficiently.",
    evaluate(ctx) {
      const limit = ctx.options.largeFileBytes;
      const large = ctx.files.filter((f) => f.size > limit).sort((a, b) => b.size - a.size);
      if (large.length === 0) return { status: "pass", summary: `No committed file exceeds ${formatBytes(limit)}.` };
      const severe = large.some((f) => f.size > 50 * 1024 * 1024);
      return {
        status: severe ? "fail" : "warn",
        summary: `${pluralize(large.length, "file")} larger than ${formatBytes(limit)}.`,
        findings: [
          {
            severity: severe ? "medium" : "low",
            title: "Large files committed directly to Git",
            description: `${pluralize(large.length, "file")} exceed ${formatBytes(limit)}. Files stored with Git LFS appear as small pointers, so these are stored in Git directly.`,
            evidence: large.slice(0, 10).map((f) => ({ path: f.path, detail: `${formatBytes(f.size)}${isBinaryExtension(f.path) ? " (binary)" : ""}` })),
            recommendation: "Move large binaries and datasets to Git LFS, a release asset, or external storage.",
            confidence: "high",
          },
        ],
      };
    },
  },

  // ===== Informational =====
  {
    id: "REPO001",
    title: "Repository actively maintained",
    category: "maintainability",
    scoreCategory: "maintainability",
    weight: 0,
    kind: "observation",
    rationale: "Archived repositories are read-only and receive no fixes. This check is informational and not scored.",
    evaluate(ctx) {
      if (!ctx.repository.archived) return { status: "pass", summary: "Repository is not archived." };
      return {
        status: "fail",
        summary: "Repository is archived (informational).",
        findings: [
          {
            severity: "info",
            title: "Repository is archived",
            description: "The owner has archived this repository; it is read-only.",
            evidence: [{ detail: "GitHub metadata: archived = true." }],
            recommendation: "If you depend on this project, look for an actively maintained fork or alternative.",
            confidence: "high",
          },
        ],
      };
    },
  },
];

// ---------- README helpers ----------

export function findReadme(ctx: AnalysisContext): string | null {
  const root = ctx.files.find((f) => isRootFile(f.path) && /^readme(\.(md|markdown|rst|txt|adoc|org))?$/i.test(f.path));
  if (root) return root.path;
  return findPath(ctx, [".github/README.md", "docs/README.md", "docs/readme.md"]);
}

export function readmeSignals(text: string): { label: string; present: boolean }[] {
  const plain = text.replace(/<!--[\s\S]*?-->/g, "");
  const headings = plain.split(/\r?\n/).filter((l) => /^\s{0,3}#{1,6}\s+\S/.test(l) || /^\s*<h[1-6][\s>]/i.test(l));
  // reStructuredText headings: a text line followed by a line of ===, ---, ~~~ …
  const rstHeadings = (plain.match(/^[^\n]+\r?\n[=\-~^"'`#*+]{3,}\s*$/gm) ?? []).map((h) => h.split(/\r?\n/)[0]);
  const allHeadings = [...headings, ...rstHeadings].join("\n");
  const searchable = `${allHeadings}\n${plain}`;
  return [
    { label: "substantive content (at least 300 characters)", present: plain.trim().length >= 300 },
    { label: "section headings", present: headings.length + rstHeadings.length >= 2 },
    { label: "installation / getting-started instructions", present: /install|getting started|get started|quick ?start|setup|set up/i.test(searchable) },
    { label: "usage or examples", present: /usage|example|how to use|running|run the|demo|tutorial/i.test(searchable) },
    { label: "code block", present: /```|~~~|^\s*\.\. code(-block)?::|^ {4}\S/m.test(plain) || /<pre[\s>]/i.test(plain) },
  ];
}
