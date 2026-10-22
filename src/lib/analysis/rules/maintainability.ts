import { basename, formatBytes, isBinaryExtension, isSourceFile, isTestFile } from "../paths";
import { isLowRiskPath, pluralize } from "./helpers";
import { MAX_EVIDENCE, type Rule } from "./types";

/** Maintainability: file sizes, committed dependencies and repository status. */
export const MAINTAINABILITY_RULES: Rule[] = [
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
      // Single-header / amalgamated builds (e.g. single_include/json.hpp, sqlite3.c amalgamation) are generated.
      const sources = ctx.files.filter(
        (f) => isSourceFile(f.path) && !isTestFile(f.path) && !/(^|\/)(single_include|amalgamation)(\/|$)|amalgamat/i.test(f.path),
      );
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
      if (heavy.size === 0 && light.size === 0)
        return { status: "pass", summary: "No dependency, virtualenv or cache directories committed." };
      const isHeavy = heavy.size > 0;
      const evidence = [...heavy.keys(), ...light.keys()].slice(0, MAX_EVIDENCE).map((p) => ({
        path: p,
        detail: heavy.has(p) ? "Dependency/virtualenv directory tracked in Git." : "Cache or OS metadata file tracked in Git.",
      }));
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
            recommendation:
              "Remove them with git rm -r --cached <path>, add the patterns to .gitignore, and reinstall dependencies from the manifest.",
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
            evidence: large
              .slice(0, 10)
              .map((f) => ({ path: f.path, detail: `${formatBytes(f.size)}${isBinaryExtension(f.path) ? " (binary)" : ""}` })),
            recommendation: "Move large binaries and datasets to Git LFS, a release asset, or external storage.",
            confidence: "high",
          },
        ],
      };
    },
  },

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
