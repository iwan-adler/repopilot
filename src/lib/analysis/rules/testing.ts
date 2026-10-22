import { isSourceFile, isTestFile } from "../paths";
import { ciSystemFor, findTestCommand } from "../workflows";
import { hasSourceCode, jsIsSecondary, rootPackage, pluralize } from "./helpers";
import { MAX_EVIDENCE, type Rule } from "./types";

/** Testing: test files, frameworks, scripts and CI test runs. Tests are detected, never executed. */
export const TESTING_RULES: Rule[] = [
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
            evidence: [
              {
                detail:
                  "Checked manifests and config files for Jest, Vitest, Mocha, Playwright, Cypress, pytest, JUnit, RSpec, PHPUnit and others.",
              },
            ],
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
      if (jsIsSecondary(ctx))
        return { status: "not_applicable", summary: "package.json only supports a non-JavaScript project's frontend tooling." };
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
      if (!hasSourceCode(ctx)) return { status: "not_applicable", summary: "No source code detected." };
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
            evidence: fetched
              .slice(0, MAX_EVIDENCE)
              .map((f) => ({ path: f.path, detail: "No test command matched (e.g. npm test, pytest, go test, cargo test)." })),
            recommendation:
              "Add a step that runs your test suite on every push and pull request. If tests run via a custom script or make target, this may be a false positive.",
            confidence: "medium",
          },
        ],
      };
    },
  },
];
