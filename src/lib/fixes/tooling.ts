/** Test, lint, format, script, lockfile and manifest starter kits. */
import type { Report } from "@/lib/reports/schema";
import { type FixKit, describeStack } from "./shared";

export function testStarter(report: Report, ruleId: "TST001" | "TST002"): FixKit | null {
  const s = describeStack(report);
  if (s.node) {
    const ext = s.typescript ? "ts" : "js";
    const install =
      s.nodeManager === "npm" ? "npm install --save-dev vitest" : s.nodeManager === "pnpm" ? "pnpm add -D vitest" : "yarn add -D vitest";
    return {
      ruleId,
      title: "Vitest starter",
      files: [
        {
          path: `tests/example.test.${ext}`,
          kind: "create",
          content: `import { describe, expect, it } from "vitest";

// Replace this with a test for your most important function.
// Good first targets: code that parses input, does calculations, or has had bugs before.
describe("example", () => {
  it("adds numbers", () => {
    expect(1 + 1).toBe(2);
  });
});
`,
        },
        { path: "package.json", kind: "snippet", content: '"scripts": {\n  "test": "vitest run"\n}\n' },
      ],
      commands: [install, s.nodeManager === "npm" ? "npm test" : `${s.nodeManager} test`],
      notes: ['Merge the "test" script into your existing scripts in package.json.'],
    };
  }
  if (s.python) {
    return {
      ruleId,
      title: "pytest starter",
      files: [
        {
          path: "tests/test_example.py",
          kind: "create",
          content: `# Replace this with a test for your most important function, e.g.:
#
#   from mypackage.utils import parse_config
#
#   def test_parse_config_reads_defaults():
#       assert parse_config({})["debug"] is False


def test_example():
    assert 1 + 1 == 2
`,
        },
        {
          path: "pyproject.toml",
          kind: s.hasPyproject ? "snippet" : "create",
          content: '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n',
        },
      ],
      commands: ["pip install pytest", "pytest"],
      notes: ["Avoid importing scripts that run work at import time (e.g. training loops); test functions instead."],
    };
  }
  return null;
}

export function npmTestScript(): FixKit {
  return {
    ruleId: "TST003",
    title: "package.json test script",
    files: [{ path: "package.json", kind: "snippet", content: '"scripts": {\n  "test": "vitest run"\n}\n' }],
    commands: [],
    notes: ['Replace "vitest run" with the command for your test runner (e.g. "jest", "mocha", "node --test").'],
  };
}

export function linter(report: Report): FixKit | null {
  const s = describeStack(report);
  if (s.node) {
    const content = s.typescript
      ? `import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  { ignores: ["dist/", "build/", "coverage/"] },
  js.configs.recommended,
  tseslint.configs.recommended,
]);
`
      : `import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";

export default defineConfig([
  { ignores: ["dist/", "build/", "coverage/"] },
  js.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
]);
`;
    const pkgs = s.typescript ? "eslint @eslint/js typescript-eslint" : "eslint @eslint/js globals";
    return {
      ruleId: "DX001",
      title: "ESLint configuration",
      files: [
        { path: "eslint.config.mjs", kind: "create", content },
        { path: "package.json", kind: "snippet", content: '"scripts": {\n  "lint": "eslint ."\n}\n' },
      ],
      commands: [s.nodeManager === "npm" ? `npm install --save-dev ${pkgs}` : `${s.nodeManager} add -D ${pkgs}`, "npx eslint ."],
      notes: ["Frameworks often ship their own preset (e.g. eslint-config-next); prefer it if you use one."],
    };
  }
  if (s.python) {
    return {
      ruleId: "DX001",
      title: "Ruff linter configuration",
      files: [
        {
          path: "pyproject.toml",
          kind: s.hasPyproject ? "snippet" : "create",
          content: '[tool.ruff]\nline-length = 100\n\n[tool.ruff.lint]\nselect = ["E", "F", "I", "B", "UP"]\n',
        },
      ],
      commands: ["pip install ruff", "ruff check ."],
      notes: ["Ruff is a fast, free linter. `ruff check --fix .` fixes many issues automatically."],
    };
  }
  return null;
}

export function formatter(report: Report): FixKit | null {
  const s = describeStack(report);
  if (s.node) {
    return {
      ruleId: "DX002",
      title: "Prettier configuration",
      files: [
        { path: ".prettierrc.json", kind: "create", content: '{\n  "printWidth": 100\n}\n' },
        { path: ".prettierignore", kind: "create", content: "dist\nbuild\ncoverage\n" },
        {
          path: "package.json",
          kind: "snippet",
          content: '"scripts": {\n  "format": "prettier --write .",\n  "format:check": "prettier --check ."\n}\n',
        },
      ],
      commands: [
        s.nodeManager === "npm" ? "npm install --save-dev prettier" : `${s.nodeManager} add -D prettier`,
        "npx prettier --write .",
      ],
      notes: ["Run the formatter once in its own commit so the big formatting diff is easy to review."],
    };
  }
  if (s.python) {
    return {
      ruleId: "DX002",
      title: "Ruff formatter configuration",
      files: [
        { path: "pyproject.toml", kind: s.hasPyproject ? "snippet" : "create", content: '[tool.ruff.format]\nquote-style = "double"\n' },
      ],
      commands: ["pip install ruff", "ruff format ."],
      notes: ["Ruff's formatter is compatible with Black."],
    };
  }
  return null;
}

export function npmScripts(): FixKit {
  return {
    ruleId: "DX004",
    title: "Conventional npm scripts",
    files: [
      {
        path: "package.json",
        kind: "snippet",
        content: '"scripts": {\n  "dev": "<start a dev server>",\n  "build": "<build for production>",\n  "lint": "eslint ."\n}\n',
      },
    ],
    commands: [],
    notes: ["Only add the scripts that apply; keep the ones you already have."],
  };
}

export function lockfile(report: Report): FixKit | null {
  const s = describeStack(report);
  if (!s.node) return null;
  const cmd = s.nodeManager === "pnpm" ? "pnpm install" : s.nodeManager === "yarn" ? "yarn install" : "npm install";
  const file = s.nodeManager === "pnpm" ? "pnpm-lock.yaml" : s.nodeManager === "yarn" ? "yarn.lock" : "package-lock.json";
  return {
    ruleId: "DEP001",
    title: "Generate and commit a lockfile",
    files: [],
    commands: [cmd, `git add ${file}`, 'git commit -m "Commit lockfile"'],
    notes: ["In CI, install with the frozen lockfile (e.g. npm ci) so builds are reproducible."],
  };
}

export function pythonManifest(report: Report): FixKit | null {
  if (!report.stack.languages.some((l) => l.name === "Python")) return null;
  const name =
    report.repository.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "project";
  return {
    ruleId: "STR002",
    title: "pyproject.toml",
    files: [
      {
        path: "pyproject.toml",
        kind: "create",
        content: `[project]
name = "${name}"
version = "0.1.0"
requires-python = ">=3.10"
# List the packages your code imports, e.g. "numpy>=1.26".
dependencies = []

[project.optional-dependencies]
dev = ["pytest", "ruff"]
`,
      },
    ],
    commands: ['pip install -e ".[dev]"'],
    notes: ["Add each third-party package your code imports to dependencies so others can install the project in one step."],
  };
}
