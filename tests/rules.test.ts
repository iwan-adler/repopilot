import { describe, expect, it } from "vitest";
import { readmeSignals, RULES } from "@/lib/analysis/rules";
import { evaluate, GOOD_README, HEALTHY_PROJECT, repoInfo } from "./helpers";

const SRC = { "src/main.py": "print('hi')\n" };

describe("rule registry", () => {
  it("has unique, stable IDs and complete metadata", () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of RULES) {
      expect(r.id).toMatch(/^[A-Z]{2,4}\d{3}$/);
      expect(r.title.length).toBeGreaterThan(3);
      expect(r.rationale.length).toBeGreaterThan(20);
      expect(r.weight).toBeGreaterThanOrEqual(0);
    }
  });

  it("every rule passes (or is n/a) on the healthy fixture", () => {
    for (const rule of RULES) {
      const outcome = evaluate(rule.id, HEALTHY_PROJECT);
      expect([rule.id, outcome.status]).toEqual([rule.id, expect.stringMatching(/^(pass|not_applicable)$/)]);
    }
  });
});

describe("structure rules", () => {
  it("STR001 .gitignore", () => {
    expect(evaluate("STR001", { ".gitignore": "x" }).status).toBe("pass");
    const r = evaluate("STR001", { "a.py": "x" });
    expect(r.status).toBe("fail");
    expect(r.findings?.[0].severity).toBe("low");
  });

  it("STR002 manifest", () => {
    expect(evaluate("STR002", { "README.md": "docs only" }).status).toBe("not_applicable");
    expect(evaluate("STR002", { ...SRC, "pyproject.toml": "[project]" }).status).toBe("pass");
    expect(evaluate("STR002", SRC).status).toBe("fail");
  });
});

describe("documentation rules", () => {
  it("DOC001 README", () => {
    expect(evaluate("DOC001", { "readme.rst": "x" }).status).toBe("pass");
    expect(evaluate("DOC001", { "docs/README.md": "x" }).status).toBe("pass");
    const r = evaluate("DOC001", SRC);
    expect(r.status).toBe("fail");
    expect(r.findings?.[0].severity).toBe("high");
  });

  it("DOC002 README completeness", () => {
    expect(evaluate("DOC002", SRC).status).toBe("not_applicable");
    expect(evaluate("DOC002", { "README.md": GOOD_README }).status).toBe("pass");
    expect(evaluate("DOC002", { "README.md": "# Title\n\nShort." }).status).toBe("fail");
    expect(evaluate("DOC002", { "README.md": 5000 }).status).toBe("unavailable");
    const partial = evaluate("DOC002", { "README.md": "# Title\n\n## Installation\n\nDownload the installer. " + "x".repeat(300) });
    expect(partial.status).toBe("warn");
    expect(partial.findings?.[0].evidence.map((e) => e.detail).join()).toMatch(/code block/);
  });

  it("readmeSignals recognizes reStructuredText headings and code", () => {
    const rst =
      "Project\n=======\n\nInstallation\n------------\n\n.. code-block:: bash\n\n   pip install x\n\nUsage\n-----\n" + "y".repeat(300);
    expect(readmeSignals(rst).every((s) => s.present)).toBe(true);
  });

  it("DOC003 license via file or GitHub metadata", () => {
    expect(evaluate("DOC003", { "LICENSE.md": "MIT" }).status).toBe("pass");
    expect(evaluate("DOC003", { COPYING: "GPL" }).status).toBe("pass");
    expect(evaluate("DOC003", SRC, { repository: repoInfo({ license: "Apache-2.0" }) }).status).toBe("pass");
    expect(evaluate("DOC003", SRC, { repository: repoInfo({ license: "NOASSERTION" }) }).status).toBe("fail");
    expect(evaluate("DOC003", SRC).status).toBe("fail");
  });

  it("DOC004 contribution guide", () => {
    expect(evaluate("DOC004", { ".github/CONTRIBUTING.md": "x" }).status).toBe("pass");
    expect(evaluate("DOC004", SRC).status).toBe("warn");
  });
});

describe("testing rules", () => {
  it("TST001 test detection across ecosystems", () => {
    expect(evaluate("TST001", { "README.md": "x" }).status).toBe("not_applicable");
    for (const p of [
      "src/a.test.ts",
      "tests/test_api.py",
      "pkg/api_test.go",
      "spec/user_spec.rb",
      "src/test/java/FooTest.java",
      "__tests__/x.js",
    ]) {
      expect([p, evaluate("TST001", { "src/a.ts": "x", [p]: "x" }).status]).toEqual([p, "pass"]);
    }
    expect(evaluate("TST001", { "src/lib.rs": "fn a(){}\n#[cfg(test)]\nmod tests {}" }).status).toBe("pass");
    const r = evaluate("TST001", SRC);
    expect(r.status).toBe("fail");
    expect(r.findings?.[0].description).not.toMatch(/truncated/);
  });

  it("TST001 does not count tests inside node_modules and lowers confidence when truncated", () => {
    expect(evaluate("TST001", { "src/a.ts": "x", "node_modules/x/a.test.js": 10 }).status).toBe("fail");
    const r = evaluate("TST001", SRC, { treeTruncated: true });
    expect(r.findings?.[0].confidence).toBe("low");
  });

  it("TST002 framework detection", () => {
    expect(evaluate("TST002", { "src/a.py": "x", "pytest.ini": "[pytest]" }).status).toBe("pass");
    expect(evaluate("TST002", { "main.go": "x", "go.mod": "module x" }).status).toBe("pass");
    expect(evaluate("TST002", { "src/a.py": "x", "tests/test_a.py": "x" }).status).toBe("warn");
    expect(evaluate("TST002", SRC).status).toBe("fail");
  });

  it("TST003 package.json test script", () => {
    expect(evaluate("TST003", SRC).status).toBe("not_applicable");
    expect(evaluate("TST003", { "package.json": 100 }).status).toBe("unavailable");
    expect(evaluate("TST003", { "package.json": "{bad" }).status).toBe("unavailable");
    expect(evaluate("TST003", { "package.json": JSON.stringify({ scripts: { "test:unit": "jest" } }) }).status).toBe("pass");
    const def = evaluate("TST003", { "package.json": JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) });
    expect(def.status).toBe("fail");
    expect(def.findings?.[0].title).toMatch(/Placeholder/);
  });

  it("TST004 CI runs tests", () => {
    expect(evaluate("TST004", SRC).status).toBe("not_applicable");
    expect(evaluate("TST004", { ...SRC, ".github/workflows/ci.yml": 100 }).status).toBe("unavailable");
    expect(evaluate("TST004", { ...SRC, ".github/workflows/ci.yml": "steps:\n  - run: pytest -q" }).status).toBe("pass");
    expect(evaluate("TST004", { ...SRC, ".gitlab-ci.yml": "test:\n  script: go test ./..." }).status).toBe("pass");
    expect(evaluate("TST004", { ...SRC, ".github/workflows/ci.yml": "steps:\n  - run: npm run build" }).status).toBe("warn");
  });
});

describe("developer-experience rules", () => {
  const js = { "src/a.ts": "x", "package.json": JSON.stringify({ name: "a" }) };

  it("DX001 linter", () => {
    expect(evaluate("DX001", { "main.c": "x" }).status).toBe("not_applicable");
    expect(evaluate("DX001", { ...js, "eslint.config.js": "x" }).status).toBe("pass");
    expect(evaluate("DX001", { ...js, "biome.json": "{}" }).status).toBe("pass");
    expect(evaluate("DX001", { ...SRC, "pyproject.toml": "[tool.ruff]\nline-length=100" }).status).toBe("pass");
    expect(evaluate("DX001", js).status).toBe("fail");
    expect(evaluate("DX001", SRC).status).toBe("fail");
  });

  it("DX002 formatter", () => {
    expect(evaluate("DX002", { "main.go": "x", "go.mod": "module x" }).status).toBe("not_applicable");
    expect(evaluate("DX002", { ...js, ".prettierrc.json": "{}" }).status).toBe("pass");
    expect(evaluate("DX002", { ...SRC, "pyproject.toml": "[tool.black]" }).status).toBe("pass");
    expect(evaluate("DX002", js).status).toBe("warn");
  });

  it("DX003 CI", () => {
    expect(evaluate("DX003", { "README.md": "x" }).status).toBe("not_applicable");
    expect(evaluate("DX003", { ...SRC, ".circleci/config.yml": "x" }).status).toBe("pass");
    expect(evaluate("DX003", { ...SRC, Jenkinsfile: "x" }).status).toBe("pass");
    expect(evaluate("DX003", SRC).status).toBe("fail");
  });

  it("DX004 npm scripts", () => {
    expect(evaluate("DX004", SRC).status).toBe("not_applicable");
    expect(evaluate("DX004", { "package.json": JSON.stringify({ scripts: { build: "x", lint: "y" } }) }).status).toBe("pass");
    expect(evaluate("DX004", { "package.json": JSON.stringify({ scripts: { build: "x" } }) }).status).toBe("warn");
    expect(evaluate("DX004", { "package.json": JSON.stringify({}) }).status).toBe("fail");
  });
});

describe("dependency rules", () => {
  it("DEP001 lockfile", () => {
    expect(evaluate("DEP001", SRC).status).toBe("not_applicable");
    const app = { "package.json": JSON.stringify({ private: true, dependencies: { react: "^19" } }) };
    expect(evaluate("DEP001", { ...app, "pnpm-lock.yaml": 10 }).status).toBe("pass");
    const r = evaluate("DEP001", app);
    expect(r.status).toBe("fail");
    expect(r.findings?.[0].severity).toBe("medium");
    const lib = evaluate("DEP001", { "package.json": JSON.stringify({ dependencies: { a: "^1" } }) });
    expect(lib.findings?.[0].severity).toBe("low");
    expect(evaluate("DEP001", { Pipfile: "[packages]" }).status).toBe("fail");
    expect(evaluate("DEP001", { "pyproject.toml": "[tool.poetry]\nname='x'", "poetry.lock": 10 }).status).toBe("pass");
  });

  it("DEP002 conflicting lockfiles", () => {
    expect(evaluate("DEP002", SRC).status).toBe("not_applicable");
    expect(evaluate("DEP002", { "yarn.lock": 1 }).status).toBe("pass");
    expect(evaluate("DEP002", { "bun.lock": 1, "bun.lockb": 1 }).status).toBe("pass");
    expect(evaluate("DEP002", { "yarn.lock": 1, "package-lock.json": 1 }).status).toBe("fail");
  });

  it("DEP003 package.json validity", () => {
    expect(evaluate("DEP003", SRC).status).toBe("not_applicable");
    expect(evaluate("DEP003", { "package.json": 10 }).status).toBe("unavailable");
    expect(evaluate("DEP003", { "package.json": '﻿{"name":"a"}' }).status).toBe("pass");
    const r = evaluate("DEP003", { "package.json": '{"name": "a",}', "packages/b/package.json": "[]" });
    expect(r.status).toBe("fail");
    expect(r.findings?.[0].evidence).toHaveLength(2);
  });

  it("DEP004 dependency automation", () => {
    expect(evaluate("DEP004", { "a.txt": "x" }).status).toBe("not_applicable");
    expect(evaluate("DEP004", { "go.mod": "x", "renovate.json": "{}" }).status).toBe("pass");
    expect(evaluate("DEP004", { "package.json": JSON.stringify({ renovate: {} }) }).status).toBe("pass");
    expect(evaluate("DEP004", { "go.mod": "x" }).status).toBe("warn");
  });

  it("DEP005 unbounded versions", () => {
    expect(evaluate("DEP005", SRC).status).toBe("not_applicable");
    expect(evaluate("DEP005", { "package.json": JSON.stringify({ dependencies: { a: "^1.0.0", b: "workspace:*" } }) }).status).toBe("pass");
    const r = evaluate("DEP005", { "package.json": JSON.stringify({ dependencies: { a: "*" }, devDependencies: { b: "latest" } }) });
    expect(r.status).toBe("fail");
    expect(r.findings?.[0].evidence).toHaveLength(2);
  });
});

describe("security rules", () => {
  const TOKEN = "ghp" + "_" + "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5";

  it("SEC001 credential patterns: fail, warn for test paths, unavailable with no content", () => {
    expect(evaluate("SEC001", { "a.py": 100 }).status).toBe("unavailable");
    expect(evaluate("SEC001", { "a.py": "print(1)" }).status).toBe("pass");
    const r = evaluate("SEC001", { "src/config.ts": `export const t = "${TOKEN}";` });
    expect(r.status).toBe("fail");
    expect(r.findings?.[0].severity).toBe("critical");
    expect(r.findings?.[0].evidence[0]).toMatchObject({ path: "src/config.ts", line: 1 });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    const t = evaluate("SEC001", { "tests/fixtures/config.ts": `t = "${TOKEN}"` });
    expect(t.status).toBe("warn");
    expect(t.findings?.[0]).toMatchObject({ severity: "low", confidence: "low" });
  });

  it("SEC002 committed .env files", () => {
    expect(evaluate("SEC002", { ".env.example": "A=", ".env.sample": "B=" }).status).toBe("pass");
    const r = evaluate("SEC002", { ".env": "A=1", "api/.env.production": "B=2" });
    expect(r.status).toBe("fail");
    expect(r.findings?.[0].evidence).toHaveLength(2);
    expect(evaluate("SEC002", { "tests/.env": "A=1" }).status).toBe("warn");
  });

  it("SEC003 key files", () => {
    expect(evaluate("SEC003", SRC).status).toBe("pass");
    expect(evaluate("SEC003", { "deploy/id_rsa": 100 }).status).toBe("fail");
    expect(evaluate("SEC003", { "deploy/id_rsa.pub": 100 }).status).toBe("pass");
    expect(evaluate("SEC003", { "test/fixtures/server.pem": 100 }).status).toBe("warn");
  });

  it("SEC004 security policy", () => {
    expect(evaluate("SEC004", { "README.md": "x" }).status).toBe("not_applicable");
    expect(evaluate("SEC004", { ...SRC, ".github/SECURITY.md": "x" }).status).toBe("pass");
    expect(evaluate("SEC004", SRC).status).toBe("warn");
  });

  it("SEC005 pull_request_target", () => {
    expect(evaluate("SEC005", SRC).status).toBe("not_applicable");
    expect(evaluate("SEC005", { ".github/workflows/a.yml": 10 }).status).toBe("unavailable");
    expect(evaluate("SEC005", { ".github/workflows/a.yml": "on: [push]\n" }).status).toBe("pass");
    expect(evaluate("SEC005", { ".github/workflows/a.yml": "on:\n  pull_request_target:\njobs: {}\n" }).status).toBe("pass");
    const risky = `on: pull_request_target
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: npm install && npm test
`;
    const r = evaluate("SEC005", { ".github/workflows/a.yml": risky });
    expect(r.status).toBe("fail");
    expect(r.findings?.[0].evidence[0].line).toBe(7);
  });

  it("SEC006 script injection", () => {
    const bad = `on: issues
jobs:
  a:
    steps:
      - run: |
          echo "Title: \${{ github.event.issue.title }}"
`;
    const r = evaluate("SEC006", { ".github/workflows/a.yml": bad });
    expect(r.status).toBe("fail");
    expect(r.findings?.[0].evidence[0].line).toBe(6);
    const safe = `jobs:
  a:
    steps:
      - env:
          TITLE: \${{ github.event.issue.title }}
        run: echo "$TITLE"
`;
    expect(evaluate("SEC006", { ".github/workflows/a.yml": safe }).status).toBe("pass");
  });

  it("SEC007 unpinned third-party actions", () => {
    const wf = `steps:
  - uses: actions/checkout@v4
  - uses: some/action@v1
  - uses: other/action@${"a".repeat(40)}
  - uses: ./local-action
`;
    const r = evaluate("SEC007", { ".github/workflows/a.yml": wf });
    expect(r.status).toBe("warn");
    expect(r.findings?.[0].evidence).toEqual([{ path: ".github/workflows/a.yml", line: 3, detail: "uses: some/action@v1" }]);
    expect(evaluate("SEC007", { ".github/workflows/a.yml": "steps:\n  - uses: actions/setup-node@v4\n" }).status).toBe("pass");
  });
});

describe("maintainability rules", () => {
  it("MNT001 oversized source files with configurable threshold", () => {
    expect(evaluate("MNT001", { "README.md": "x" }).status).toBe("not_applicable");
    expect(evaluate("MNT001", { "src/a.ts": 50_000 }).status).toBe("pass");
    expect(evaluate("MNT001", { "src/a.ts": 150_000 }).status).toBe("warn");
    expect(evaluate("MNT001", { "src/a.ts": 400_000 }).status).toBe("fail");
    // Generated, vendored and minified files are excluded.
    expect(
      evaluate("MNT001", { "src/a.ts": 10, "dist/bundle.js": 900_000, "public/x.min.js": 900_000, "vendor/lib.c": 900_000 }).status,
    ).toBe("pass");
    const custom = { oversizedFileBytes: 1000, largeFileBytes: 5_000_000 };
    expect(evaluate("MNT001", { "src/a.ts": 2000 }, { options: custom }).status).toBe("warn");
  });

  it("MNT002 committed dependency and cache directories", () => {
    expect(evaluate("MNT002", SRC).status).toBe("pass");
    const r = evaluate("MNT002", { "node_modules/react/index.js": 10, "node_modules/react/package.json": 10 });
    expect(r.status).toBe("fail");
    expect(r.findings?.[0].evidence[0].path).toBe("node_modules");
    expect(evaluate("MNT002", { ".DS_Store": 10, "app/__pycache__/a.pyc": 10 }).status).toBe("warn");
    expect(evaluate("MNT002", { "venv/pyvenv.cfg": 10 }).status).toBe("fail");
  });

  it("MNT003 large files", () => {
    expect(evaluate("MNT003", { "a.bin": 1000 }).status).toBe("pass");
    expect(evaluate("MNT003", { "data/model.onnx": 10 * 1024 * 1024 }).status).toBe("warn");
    expect(evaluate("MNT003", { "data/model.onnx": 60 * 1024 * 1024 }).status).toBe("fail");
  });

  it("REPO001 archived is informational", () => {
    expect(evaluate("REPO001", SRC).status).toBe("pass");
    const r = evaluate("REPO001", SRC, { repository: repoInfo({ archived: true }) });
    expect(r.findings?.[0].severity).toBe("info");
    expect(RULES.find((x) => x.id === "REPO001")?.weight).toBe(0);
  });
});

describe("rule regressions from real-repository scans", () => {
  it("MNT001 ignores large test files (often fixtures)", () => {
    expect(evaluate("MNT001", { "src/a.ts": 10, "test/hooks.ts": 190_000 }).status).toBe("pass");
  });
});

describe("rule regressions from scanning microsoft/vscode", () => {
  it("MNT002 ignores node_modules used as test fixtures", () => {
    expect(evaluate("MNT002", { "server/test/linksTestFixtures/node_modules/a/index.js": 10 }).status).toBe("pass");
  });

  it("DX004 recognizes eslint/check-* and compile/watch script names", () => {
    const pkg = { "package.json": JSON.stringify({ scripts: { compile: "x", eslint: "y", "check-cyclic-dependencies": "z" } }) };
    expect(evaluate("DX004", pkg).status).toBe("pass");
  });

  it("SEC002 ignores empty .env files", () => {
    expect(evaluate("SEC002", { "fixtures/case/.env": 0 }).status).toBe("pass");
  });

  it("DX002 accepts tsfmt.json", () => {
    expect(evaluate("DX002", { "src/a.ts": "x", "package.json": "{}", "tsfmt.json": "{}" }).status).toBe("pass");
  });
});

describe("community file detection (found in the accuracy study)", () => {
  it("DOC004 accepts any doc extension in root, docs/ or .github/", () => {
    for (const p of ["docs/contributing.rst", "CONTRIBUTING.adoc", ".github/contributing.md", "contributing.txt"]) {
      expect([p, evaluate("DOC004", { ...SRC, [p]: "x" }).status]).toEqual([p, "pass"]);
    }
    expect(evaluate("DOC004", { ...SRC, "src/contributing.md": "x" }).status).toBe("warn");
  });

  it("SEC004 accepts any doc extension in root, docs/ or .github/", () => {
    for (const p of ["SECURITY.rst", "docs/security.md", ".github/SECURITY.txt"]) {
      expect([p, evaluate("SEC004", { ...SRC, [p]: "x" }).status]).toEqual([p, "pass"]);
    }
    expect(evaluate("SEC004", { ...SRC, "docs/security-notes.md": "x" }).status).toBe("warn");
  });
});
