/**
 * Regression tests for every false positive found in the accuracy study (docs/VALIDATION.md).
 * Each case reproduces the pattern seen in a real repository.
 */
import { describe, expect, it } from "vitest";
import { analyzeRepository } from "@/lib/analysis/analyze-repository";
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
