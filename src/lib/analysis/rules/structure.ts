import { findPath } from "../context";
import { isSourceFile } from "../paths";
import { hasSourceCode, pluralize } from "./helpers";
import type { Rule } from "./types";

/** Repository structure: .gitignore and project manifests. */
export const STRUCTURE_RULES: Rule[] = [
  {
    id: "STR001",
    title: ".gitignore present",
    category: "structure",
    scoreCategory: "hygiene",
    weight: 1,
    kind: "observation",
    rationale: "A .gitignore keeps build output, dependencies, editor files, and local secrets out of version control.",
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
];
