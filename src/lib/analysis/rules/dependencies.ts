import type { Evidence } from "@/lib/reports/schema";
import { findPath } from "../context";
import { fetchedPackageJsons } from "../detect-stack";
import { allDependencies, parsePackageJson } from "../manifests";
import { basename, isNonAuthoredPath } from "../paths";
import { rootPackage, textOf, isLowRiskPath, pluralize } from "./helpers";
import { MAX_EVIDENCE, type Rule } from "./types";

/** Dependency hygiene: lockfiles, manifests and update automation. */
export const DEPENDENCY_RULES: Rule[] = [
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
          if (!lock)
            issues.push({
              path: "package.json",
              detail: `${Object.keys(deps).length} dependencies declared but no npm/Yarn/pnpm/Bun lockfile at the root.`,
            });
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
            recommendation:
              "Commit the lockfile your package manager generates (e.g. package-lock.json, pnpm-lock.yaml, poetry.lock) and use frozen installs in CI (npm ci).",
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
      if (invalid.length === 0)
        return { status: "pass", summary: `${pluralize(fetched.length, "package.json file")} parsed successfully.` };
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
        ".github/dependabot.yml",
        ".github/dependabot.yaml",
        "renovate.json",
        "renovate.json5",
        ".renovaterc",
        ".renovaterc.json",
        ".github/renovate.json",
        ".github/renovate.json5",
        ".gitlab/renovate.json",
      ]);
      const root = rootPackage(ctx);
      if (path) return { status: "pass", summary: `Configured via ${path}.` };
      if (root.state === "ok" && root.pkg.renovate !== undefined)
        return { status: "pass", summary: 'Renovate configured in package.json "renovate" key.' };
      return {
        status: "warn",
        summary: "No Dependabot or Renovate configuration.",
        findings: [
          {
            severity: "low",
            title: "No automated dependency updates",
            description: "No Dependabot or Renovate configuration was found.",
            evidence: [{ detail: "Checked .github/dependabot.yml and common Renovate config locations." }],
            recommendation:
              "Add .github/dependabot.yml (free on GitHub) to receive update and security pull requests for your dependencies.",
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
      // Examples and test fixtures often track "latest" on purpose; only shipped manifests are a real risk.
      const onlyLowRisk = evidence.every((e) => e.path && isLowRiskPath(e.path));
      return {
        status: onlyLowRisk ? "warn" : "fail",
        summary: `${pluralize(evidence.length, "unbounded version specifier")}${onlyLowRisk ? " (examples/tests only)" : ""}.`,
        findings: [
          {
            severity: onlyLowRisk ? "low" : "medium",
            title: "Unbounded dependency versions",
            description:
              `${pluralize(evidence.length, "dependency", "dependencies")} accept any version.` +
              (onlyLowRisk ? " All are in example or test manifests, which is lower risk." : ""),
            evidence: evidence.slice(0, MAX_EVIDENCE),
            recommendation:
              'Replace "*" / "latest" with a semver range (e.g. "^4.2.0") and rely on the lockfile plus Dependabot for updates.',
            confidence: "high",
          },
        ],
      };
    },
  },
];
