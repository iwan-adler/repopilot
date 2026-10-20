import { describe, expect, it } from "vitest";
import { detectLanguages, detectStack } from "@/lib/analysis/detect-stack";
import { findManifests, parsePackageJson } from "@/lib/analysis/manifests";
import { isSourceFile, isTestFile } from "@/lib/analysis/paths";
import { baseContext, HEALTHY_PROJECT } from "./helpers";

describe("detectStack", () => {
  it("detects a Next.js + Vitest project", () => {
    const stack = detectStack(baseContext(HEALTHY_PROJECT));
    expect(stack.frameworks.map((f) => f.name)).toEqual(expect.arrayContaining(["Next.js", "React"]));
    expect(stack.testFrameworks.map((f) => f.name)).toContain("Vitest");
    expect(stack.packageManagers.map((p) => p.name)).toEqual(["npm"]);
    expect(stack.manifests).toEqual([{ path: "package.json", ecosystem: "JavaScript/TypeScript (npm)" }]);
    expect(stack.ecosystems).toEqual(["JavaScript/TypeScript (npm)"]);
  });

  it("detects Python frameworks from requirements and pyproject", () => {
    const stack = detectStack(
      baseContext({
        "requirements.txt": "Django==5.0\npytest>=8\n",
        "pyproject.toml": '[project]\ndependencies = ["fastapi>=0.110"]\n',
        "manage.py": "x",
      }),
    );
    const names = stack.frameworks.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(["Django", "FastAPI"]));
    expect(stack.testFrameworks.map((f) => f.name)).toContain("pytest");
    expect(stack.ecosystems).toEqual(["Python"]);
  });

  it("detects Go, Rust, Ruby and Java frameworks", () => {
    const stack = detectStack(
      baseContext({
        "go.mod": "module x\nrequire github.com/gin-gonic/gin v1.9.0\n",
        "Cargo.toml": '[dependencies]\naxum = "0.7"\n',
        Gemfile: "gem 'rails', '~> 7'\ngem 'rspec-rails'\n",
        "pom.xml": "<artifactId>spring-boot-starter</artifactId><artifactId>junit-jupiter</artifactId>",
      }),
    );
    const names = stack.frameworks.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(["Gin", "Axum", "Ruby on Rails", "Spring Boot"]));
    const tests = stack.testFrameworks.map((f) => f.name);
    expect(tests).toEqual(expect.arrayContaining(["go test (built-in)", "cargo test (built-in)", "RSpec", "JUnit"]));
  });

  it("ignores manifests inside vendored directories and deep paths", () => {
    const m = findManifests(baseContext({ "node_modules/x/package.json": 1, "a/b/c/d/package.json": 1, "web/package.json": 1 }).files);
    expect(m.map((x) => x.path)).toEqual(["web/package.json"]);
  });

  it("detects the packageManager field", () => {
    const stack = detectStack(baseContext({ "package.json": JSON.stringify({ packageManager: "pnpm@9.0.0" }) }));
    expect(stack.packageManagers.map((p) => p.name)).toEqual(["pnpm"]);
  });

  it("returns an empty stack for an empty file list", () => {
    const stack = detectStack(baseContext({}));
    expect(stack).toMatchObject({ primaryLanguage: null, languages: [], languageSource: "none", frameworks: [], manifests: [] });
  });
});

describe("detectLanguages", () => {
  it("prefers GitHub linguist data", () => {
    const r = detectLanguages({ files: [], languages: { TypeScript: 750, CSS: 250 } });
    expect(r.languageSource).toBe("github-linguist");
    expect(r.primaryLanguage).toBe("TypeScript");
    expect(r.languages).toEqual([
      { name: "TypeScript", bytes: 750, percent: 75 },
      { name: "CSS", bytes: 250, percent: 25 },
    ]);
  });

  it("falls back to file extensions", () => {
    const r = detectLanguages({
      files: [
        { path: "a.py", size: 300 },
        { path: "b.go", size: 100 },
        { path: "node_modules/x.js", size: 9999 },
      ],
      languages: null,
    });
    expect(r.languageSource).toBe("file-extensions");
    expect(r.languages.map((l) => l.name)).toEqual(["Python", "Go"]);
  });
});

describe("path classification", () => {
  it("classifies source and test files", () => {
    expect(isSourceFile("src/a.ts")).toBe(true);
    expect(isSourceFile("src/a.d.ts")).toBe(false);
    expect(isSourceFile("dist/a.js")).toBe(false);
    expect(isSourceFile("a.min.js")).toBe(false);
    expect(isTestFile("src/a.spec.tsx")).toBe(true);
    expect(isTestFile("tests/helpers.py")).toBe(true);
    expect(isTestFile("tests/data.json")).toBe(false);
    expect(isTestFile("src/contest.py")).toBe(false);
  });
});

describe("parsePackageJson", () => {
  it("handles valid, invalid and wrongly typed manifests", () => {
    expect(parsePackageJson('{"name":"a","scripts":{"test":"x","bad":5}}')).toMatchObject({ ok: true, data: { scripts: { test: "x" } } });
    expect(parsePackageJson("{,}").ok).toBe(false);
    expect(parsePackageJson("[]").ok).toBe(false);
    expect(parsePackageJson('{"name": 5}').ok).toBe(false);
  });
});

describe("framework detection regressions", () => {
  it("does not report test-only devDependencies as the project's framework", () => {
    const stack = detectStack(
      baseContext({ "package.json": JSON.stringify({ devDependencies: { express: "^4", vite: "^6" }, dependencies: { ky: "^1" } }) }),
    );
    expect(stack.frameworks.map((f) => f.name)).toEqual(["Vite"]);
  });

  it("counts peerDependencies (libraries built for a framework)", () => {
    const stack = detectStack(baseContext({ "package.json": JSON.stringify({ peerDependencies: { react: ">=18" } }) }));
    expect(stack.frameworks.map((f) => f.name)).toEqual(["React"]);
  });
});
