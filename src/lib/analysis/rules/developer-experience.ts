import { findPath } from "../context";
import { fetchedPackageJsons } from "../detect-stack";
import { allDependencies } from "../manifests";
import { ciSystemFor } from "../workflows";
import {
  hasSourceCode,
  hasEcosystem,
  usesLanguage,
  isJsProject,
  isPythonProject,
  FORMATTER_CMD_RE,
  LINTER_CMD_RE,
  scriptsUse,
  jsIsSecondary,
  rootPackage,
  textOf,
  anyFile,
  pluralize,
} from "./helpers";
import type { Rule } from "./types";

/** Developer experience: linters, formatters, CI and conventional scripts. */
export const DEVELOPER_EXPERIENCE_RULES: Rule[] = [
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
        const file = anyFile(
          ctx,
          /(^|\/)(eslint\.config\.[cm]?[jt]s|\.eslintrc(\.(js|cjs|json|ya?ml))?|biome\.jsonc?|\.oxlintrc\.json|deno\.jsonc?|\.jshintrc|tslint\.json)$/,
        );
        const dep = pkgs.find(({ pkg }) => {
          const d = allDependencies(pkg);
          return d.eslint || d["@biomejs/biome"] || d.oxlint || d.xo || d.standard || pkg.eslintConfig || scriptsUse(pkg, LINTER_CMD_RE);
        });
        checks.push({
          applies: true,
          ecosystem: "JavaScript/TypeScript",
          found: file?.path ?? (dep ? `lint dependency in ${dep.path}` : null),
        });
      }
      if (isPythonProject(ctx)) {
        const file = anyFile(ctx, /(^|\/)(ruff\.toml|\.ruff\.toml|\.flake8|\.pylintrc|pylintrc)$/);
        const pyproject = textOf(ctx, findPath(ctx, ["pyproject.toml"]));
        const setupCfg = textOf(ctx, findPath(ctx, ["setup.cfg", "tox.ini"]));
        // Static analysis also counts when configured via type checkers or pre-commit hooks.
        const inPyproject = pyproject && /^\s*\[tool\.(ruff|pylint|flake8|mypy|pyright)/m.test(pyproject);
        const inSetup = setupCfg && /^\s*\[(flake8|mypy)\]/m.test(setupCfg);
        const preCommit = textOf(ctx, findPath(ctx, [".pre-commit-config.yaml", ".pre-commit-config.yml"])) ?? "";
        const inPreCommit = /\b(id:\s*(flake8|ruff|ruff-check|pylint|mypy|pyright|pyflakes|bandit)\b|pre-commit\/pygrep-hooks)/.test(
          preCommit,
        );
        const mypyIni = findPath(ctx, ["mypy.ini", ".mypy.ini"]);
        checks.push({
          applies: true,
          ecosystem: "Python",
          found:
            file?.path ??
            mypyIni ??
            (inPyproject
              ? "pyproject.toml [tool.*] lint section"
              : inSetup
                ? "setup.cfg/tox.ini lint section"
                : inPreCommit
                  ? "linter hooks in .pre-commit-config.yaml"
                  : null),
        });
      }
      if (hasEcosystem(ctx, "Ruby") || usesLanguage(ctx, ["Ruby"])) {
        checks.push({ applies: true, ecosystem: "Ruby", found: anyFile(ctx, /(^|\/)\.(rubocop|standard)\.ya?ml$/)?.path ?? null });
      }
      if (hasEcosystem(ctx, "PHP") || usesLanguage(ctx, ["PHP"])) {
        const file = anyFile(ctx, /(^|\/)(phpcs\.xml(\.dist)?|phpstan\.neon(\.dist)?|psalm\.xml|pint\.json|\.php-cs-fixer(\.dist)?\.php)$/);
        const composer = textOf(ctx, findPath(ctx, ["composer.json"])) ?? "";
        const dep = /"(laravel\/pint|friendsofphp\/php-cs-fixer|squizlabs\/php_codesniffer|phpstan\/phpstan|vimeo\/psalm)"/.exec(composer);
        checks.push({ applies: true, ecosystem: "PHP", found: file?.path ?? (dep ? `${dep[1]} in composer.json` : null) });
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
            description: "No linter configuration file or linter dependency was found for these ecosystems.",
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
        const file = anyFile(
          ctx,
          /(^|\/)(\.prettierrc(\.(json|ya?ml|js|cjs|mjs|toml|json5))?|prettier\.config\.[cm]?[jt]s|biome\.jsonc?|dprint\.jsonc?|deno\.jsonc?|tsfmt\.json)$/,
        );
        const dep = pkgs.find(({ pkg }) => {
          const d = allDependencies(pkg);
          // xo and standard enforce code style with --fix, so they count as formatters here.
          // Tools can also be run from scripts without a direct dependency (e.g. `oxfmt` in a format script).
          return (
            d.prettier ||
            d["@biomejs/biome"] ||
            d.dprint ||
            d.xo ||
            d.standard ||
            d.oxfmt ||
            pkg.prettier ||
            scriptsUse(pkg, FORMATTER_CMD_RE)
          );
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
            recommendation:
              "Adopt an automatic formatter (Prettier or Biome for JS/TS; Ruff or Black for Python) and enforce it in CI or a pre-commit hook.",
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
            description:
              "No configuration for GitHub Actions, GitLab CI, CircleCI, Travis, Azure Pipelines, Jenkins, or similar systems was found.",
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
      if (jsIsSecondary(ctx))
        return { status: "not_applicable", summary: "package.json only supports a non-JavaScript project's frontend tooling." };
      if (root.state !== "ok") return { status: "unavailable", summary: "package.json not available for parsing." };
      const keys = Object.keys(root.pkg.scripts ?? {});
      // Match script-name segments anywhere, e.g. "test:lint", "fix:lint", "lint-staged".
      const hasRun = keys.some((k) => /(^|[:-])(build|dev|start|serve|compile|watch)([:-]|$)/.test(k));
      const hasLint = keys.some((k) => /(^|[:-])(lint|eslint|stylelint|biome|check|format|prettier|typecheck|tsc|types)([:-]|$)/.test(k));
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
            evidence: [
              {
                path: "package.json",
                detail: `Defined scripts: ${keys.slice(0, 20).join(", ") || "(none)"}${keys.length > 20 ? ` (+${keys.length - 20} more)` : ""}`,
              },
            ],
            recommendation: 'Add scripts such as "dev", "build" and "lint" so contributors can run common tasks with npm run <name>.',
            confidence: "high",
          },
        ],
      };
    },
  },
];
