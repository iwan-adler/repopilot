/**
 * Regression tests for every false positive found in the accuracy study (docs/VALIDATION.md).
 * Each case reproduces the pattern seen in a real repository.
 */
import { describe, expect, it } from "vitest";
import { analyzeRepository, resolveSymlinkTarget } from "@/lib/analysis/analyze-repository";
import { RULES } from "@/lib/analysis/rules";
import { findTestCommand } from "@/lib/analysis/workflows";
import { GitHubClient } from "@/lib/github/client";
import { fakeGitHub } from "./fake-github";
import { evaluate } from "./helpers";

const C_PROJECT = { "src/server.c": "int main(){}", Makefile: "all:" };

describe("TST004: CI test detection (requests, cobra, ripgrep, laravel, redis)", () => {
  it.each([
    ["step named 'Run tests' (psf/requests)", "steps:\n    - name: Run tests\n      run: make ci\n"],
    ["test job id (spf13/cobra)", "jobs:\n  test-unix:\n    runs-on: ubuntu-latest\n"],
    ["cargo via a variable (BurntSushi/ripgrep)", "      - run: ${{ env.CARGO }} test --verbose --workspace\n"],
    ["artisan test (laravel/laravel)", "      - name: Execute tests\n        run: php artisan test\n"],
    ["custom runner (redis/redis)", "      run: |\n        ./runtest --verbose --tags -slow\n"],
    ["cross test", "      - run: cross test --target armv7\n"],
  ])("recognizes %s", (_name, yml) => {
    expect(findTestCommand(yml)).not.toBeNull();
  });

  it("does not treat publishing jobs or comments as tests", () => {
    expect(findTestCommand("jobs:\n  test-pypi-only:\n    steps:\n      - run: twine upload dist/*\n")).toBeNull();
    expect(findTestCommand("# run the tests later\n      - run: npm run build\n")).toBeNull();
    expect(findTestCommand("      - name: Publish to test PyPI\n")).toBeNull();
  });
});

describe("DOC004 / SEC004: community files", () => {
  it("accepts docs/contributing.rst (pallets/flask)", () => {
    expect(evaluate("DOC004", { ...C_PROJECT, "docs/contributing.rst": "x" }).status).toBe("pass");
  });

  it("accepts organization defaults from {owner}/.github (express, gson, laravel, ...)", () => {
    const org = { contributing: "acme/.github/CONTRIBUTING.md", security: "acme/.github/SECURITY.md" };
    const doc = evaluate("DOC004", C_PROJECT, { orgCommunityFiles: org });
    expect(doc).toMatchObject({ status: "pass", summary: expect.stringContaining("acme/.github/CONTRIBUTING.md") });
    expect(evaluate("SEC004", C_PROJECT, { orgCommunityFiles: org }).status).toBe("pass");
    expect(evaluate("SEC004", C_PROJECT, { orgCommunityFiles: { contributing: null, security: null } }).status).toBe("warn");
  });

  it("looks up organization defaults on raw.githubusercontent.com only when the repo has none", async () => {
    const gh = fakeGitHub({
      files: { "src/main.c": "int main(){}", "CONTRIBUTING.md": "x" },
      overrides: { "raw.githubusercontent.com/acme/.github/HEAD/SECURITY.md": () => new Response("policy", { status: 200 }) },
    });
    const r = await analyzeRepository("acme", "widget", { client: new GitHubClient({ fetch: gh.fetch }) });
    expect(r.checks.find((c) => c.ruleId === "SEC004")).toMatchObject({
      status: "pass",
      summary: expect.stringContaining("acme/.github/SECURITY.md"),
    });
    // CONTRIBUTING.md exists in the repo, so no org lookup was made for it.
    expect(gh.calls.some((c) => /acme\/\.github\/HEAD\/.*contributing/i.test(c.url))).toBe(false);
    // Org lookups never use the rate-limited API origin.
    expect(gh.calls.filter((c) => c.url.includes("/repos/acme/.github"))).toHaveLength(0);
  });

  it("still reports missing files when the org has no defaults", async () => {
    const gh = fakeGitHub({ files: { "src/main.c": "int main(){}" } });
    const r = await analyzeRepository("acme", "widget", { client: new GitHubClient({ fetch: gh.fetch }) });
    expect(r.checks.find((c) => c.ruleId === "SEC004")?.status).toBe("warn");
    expect(r.checks.find((c) => c.ruleId === "DOC004")?.status).toBe("warn");
  });
});

describe("SEC005: pull_request_target without checkout (cobra, fzf, nlohmann/json)", () => {
  it("passes with an informational note for labeler-style workflows", () => {
    const labeler = "on: pull_request_target\njobs:\n  label:\n    steps:\n      - uses: actions/labeler@v5\n";
    const r = evaluate("SEC005", { ".github/workflows/labeler.yml": labeler });
    expect(r.status).toBe("pass");
    expect(r.findings?.[0].severity).toBe("info");
  });
});

describe("DX001 / DX002: secondary languages and PHP/JS tools", () => {
  it("doesn't require a Python linter for a C project with small Python helpers (redis, nlohmann/json)", () => {
    const languages = { C: 9_000, Python: 800 };
    expect(evaluate("DX001", { ...C_PROJECT, "utils/gen.py": "x" }, { languages }).status).toBe("not_applicable");
    expect(evaluate("DX002", { ...C_PROJECT, "utils/gen.py": "x" }, { languages }).status).toBe("not_applicable");
  });

  it("still requires one when Python is a significant share", () => {
    expect(evaluate("DX001", { ...C_PROJECT, "gen.py": "x" }, { languages: { C: 6_000, Python: 4_000 } }).status).toBe("fail");
  });

  it("detects Laravel Pint and other PHP linters declared in composer.json", () => {
    const composer = JSON.stringify({ "require-dev": { "laravel/pint": "^1.13" } });
    expect(evaluate("DX001", { "composer.json": composer, "app/Http/Kernel.php": "<?php" }, { languages: { PHP: 100 } }).status).toBe(
      "pass",
    );
  });

  it("counts xo and standard as formatters (sindresorhus/ky, chalk/chalk)", () => {
    const pkg = JSON.stringify({ devDependencies: { xo: "^0.60" } });
    expect(evaluate("DX002", { "package.json": pkg, "source/index.ts": "x" }).status).toBe("pass");
  });
});

describe("MNT001: generated single-header builds (nlohmann/json)", () => {
  it("excludes single_include and amalgamation files", () => {
    expect(evaluate("MNT001", { "single_include/nlohmann/json.hpp": 1_500_000, "src/a.cpp": 10 }).status).toBe("pass");
    expect(evaluate("MNT001", { "dist/sqlite3-amalgamation.c": 9_000_000, "src/a.c": 10 }).status).toBe("pass");
  });
});

describe("DEP005: unbounded versions in examples (axios, swr)", () => {
  it("downgrades to warn/low when only example or test manifests are affected", () => {
    const r = evaluate("DEP005", { "examples/demo/package.json": JSON.stringify({ dependencies: { next: "latest" } }) });
    expect(r.status).toBe("warn");
    expect(r.findings?.[0].severity).toBe("low");
  });

  it("still fails for the root manifest", () => {
    expect(evaluate("DEP005", { "package.json": JSON.stringify({ dependencies: { next: "latest" } }) }).status).toBe("fail");
  });
});

describe("TST003 / DX004: npm scripts in non-JS projects (laravel/laravel)", () => {
  it("is not applicable when package.json only serves a PHP app's frontend", () => {
    const spec = { "composer.json": "{}", "package.json": JSON.stringify({ scripts: { build: "vite build" } }), "app/Kernel.php": "<?php" };
    const languages = { Blade: 5_000, PHP: 4_000, JavaScript: 100 };
    expect(evaluate("TST003", spec, { languages }).status).toBe("not_applicable");
    expect(evaluate("DX004", spec, { languages }).status).toBe("not_applicable");
  });

  it("still applies to JavaScript projects", () => {
    expect(evaluate("TST003", { "package.json": JSON.stringify({ scripts: {} }), "src/a.ts": "x" }).status).toBe("fail");
  });
});

describe("TST002: CMake/CTest projects (nlohmann/json)", () => {
  it("detects CTest and doctest from CMakeLists.txt", () => {
    const cmake = "enable_testing()\nadd_subdirectory(tests)\nfind_package(doctest)\n";
    const r = evaluate("TST002", { "CMakeLists.txt": cmake, "src/a.cpp": "x" });
    expect(r.status).toBe("pass");
    expect(r.summary).toMatch(/CTest/);
  });
});

it("every rule still has a unique ID after the study changes", () => {
  expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
});

describe("DX001 / DX002: tools run from package.json scripts (vercel/swr, found after the 0.3.0 run)", () => {
  it("detects oxfmt and oxlint invoked from scripts without a direct dependency", () => {
    const pkg = JSON.stringify({ scripts: { format: "oxfmt '**/*.ts'", lint: "oxlint ." } });
    expect(evaluate("DX002", { "package.json": pkg, "src/a.ts": "x" }).status).toBe("pass");
    expect(evaluate("DX001", { "package.json": pkg, "src/a.ts": "x" }).status).toBe("pass");
  });

  it("detects tools after && and via npx, but not unrelated words", () => {
    const ok = JSON.stringify({ scripts: { check: "tsc --noEmit && npx prettier --check ." } });
    expect(evaluate("DX002", { "package.json": ok, "src/a.ts": "x" }).status).toBe("pass");
    const no = JSON.stringify({ scripts: { build: "node build-prettier-docs.js" } });
    expect(evaluate("DX002", { "package.json": no, "src/a.ts": "x" }).status).toBe("warn");
  });
});

describe("DX001 / DX002: nested helper manifests (redis, nlohmann/json, laravel; found in the 0.3.0 run)", () => {
  it("ignores Python helper requirements in a C/C++ project", () => {
    const spec = { ...C_PROJECT, "tools/gen/requirements.txt": "jinja2\n", "tools/gen/gen.py": "x" };
    const languages = { C: 9_000, Python: 500 };
    expect(evaluate("DX001", spec, { languages }).status).toBe("not_applicable");
    expect(evaluate("DX002", spec, { languages }).status).toBe("not_applicable");
  });

  it("ignores a frontend-only package.json in a PHP app", () => {
    const spec = { "composer.json": "{}", "package.json": "{}", "app/Kernel.php": "<?php", "resources/js/app.js": "x" };
    const languages = { Blade: 5_000, PHP: 4_000, JavaScript: 200 };
    expect(evaluate("DX002", spec, { languages }).status).toBe("not_applicable");
  });

  it("still checks a root-level Python project", () => {
    expect(evaluate("DX001", { "pyproject.toml": "[project]", "src/app.py": "x" }, { languages: { Python: 100 } }).status).toBe("fail");
  });
});

describe("hold-out false positives (engine 0.3.1, fixed in 0.3.2)", () => {
  it("TST004 is not applicable to repositories without source code (github/gitignore)", () => {
    const spec = {
      "Python.gitignore": "__pycache__/",
      ".github/workflows/stale.yml": "on: schedule\njobs:\n  s:\n    steps:\n      - uses: actions/stale@v9\n",
    };
    expect(evaluate("TST004", spec).status).toBe("not_applicable");
  });

  it("DX004 recognizes test:lint / fix:lint script names (pmndrs/zustand)", () => {
    const pkg = JSON.stringify({ scripts: { build: "rollup -c", "test:lint": "eslint .", "fix:lint": "eslint --fix ." } });
    expect(evaluate("DX004", { "package.json": pkg, "src/a.ts": "x" }).status).toBe("pass");
  });

  it("DX001 counts pre-commit linter hooks and mypy (Textualize/rich)", () => {
    const precommit = "repos:\n  - repo: https://github.com/pre-commit/pygrep-hooks\n    hooks:\n      - id: python-no-log-warn\n";
    expect(evaluate("DX001", { "rich/a.py": "x", ".pre-commit-config.yaml": precommit }, { languages: { Python: 100 } }).status).toBe(
      "pass",
    );
    expect(
      evaluate("DX001", { "rich/a.py": "x", "pyproject.toml": "[tool.mypy]\nstrict = true\n" }, { languages: { Python: 100 } }).status,
    ).toBe("pass");
    expect(
      evaluate(
        "DX001",
        { "rich/a.py": "x", ".pre-commit-config.yaml": "repos:\n  - repo: x\n    hooks:\n      - id: trailing-whitespace\n" },
        { languages: { Python: 100 } },
      ).status,
    ).toBe("fail");
  });

  it("SEC003 ignores public PGP keys and certificates but not private keys (jqlang/jq)", () => {
    const pub = "-----BEGIN PGP PUBLIC KEY BLOCK-----\nmQINBF...\n-----END PGP PUBLIC KEY BLOCK-----\n";
    expect(evaluate("SEC003", { "sig/jq-release.key": pub, "src/a.c": "x" }).status).toBe("pass");
    expect(evaluate("SEC003", { "certs/ca.pem": "-----BEGIN CERTIFICATE-----\nMIIB\n", "src/a.c": "x" }).status).toBe("pass");
    const priv = "-----BEGIN " + "RSA PRIVATE KEY-----\nMIIE\n";
    expect(evaluate("SEC003", { "deploy/server.key": priv, "src/a.c": "x" }).status).toBe("fail");
    // Not fetched: still flagged by name, as before.
    expect(evaluate("SEC003", { "deploy/server.key": 2000, "src/a.c": "x" }).status).toBe("fail");
  });
});

describe("README symlinks (colinhacks/zod, tokio-rs/axum)", () => {
  it("resolves symlink targets safely", () => {
    expect(resolveSymlinkTarget("README.md", "packages/zod/README.md")).toBe("packages/zod/README.md");
    expect(resolveSymlinkTarget("docs/README.md", "../axum/README.md")).toBe("axum/README.md");
    expect(resolveSymlinkTarget("README.md", "../../etc/passwd")).toBeNull();
    expect(resolveSymlinkTarget("README.md", "/etc/passwd")).toBeNull();
    expect(resolveSymlinkTarget("README.md", "")).toBeNull();
  });

  it("analyzes the symlink target's content instead of the link text", async () => {
    const long =
      "# Axum\n\nErgonomic web framework. " +
      "x".repeat(300) +
      "\n\n## Installation\n\n```\ncargo add axum\n```\n\n## Usage\n\nExample below.\n";
    const gh = fakeGitHub({
      files: { "README.md": "axum/README.md", "axum/README.md": long, "axum/src/lib.rs": "pub fn a() {}" },
      overrides: {},
    });
    // Mark README.md as a symlink in the tree response.
    const fetchWithMode: typeof gh.fetch = async (url, init) => {
      const res = await gh.fetch(url, init);
      if (!url.includes("/git/trees/")) return res;
      const body = await res.json();
      for (const e of body.tree) if (e.path === "README.md") e.mode = "120000";
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    };
    const r = await analyzeRepository("acme", "widget", { client: new GitHubClient({ fetch: fetchWithMode }) });
    expect(r.checks.find((c) => c.ruleId === "DOC002")).toMatchObject({ status: "pass", summary: "5/5 completeness signals present." });
  });
});
