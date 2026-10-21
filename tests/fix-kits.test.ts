import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { RULES } from "@/lib/analysis/rules";
import { fixKitFor, RULES_WITH_FIX_KITS, safePath } from "@/lib/fixes/fix-kits";
import type { Report } from "@/lib/reports/schema";
import { repoInfo, report, type FileSpec } from "./helpers";

const TS_APP: FileSpec = {
  "README.md": "# app",
  "package.json": JSON.stringify({ name: "app", private: true, scripts: { start: "node ." }, dependencies: { express: "^4" } }),
  "src/index.ts": "export const x = 1;\n",
};
const PY_APP: FileSpec = { "README.md": "# ml", "train.py": "print(1)\n", "model.py": "x = 1\n" };
const POLYGLOT: FileSpec = {
  "go.mod": "module example.com/x\n",
  "main.go": "package main\n",
  "Cargo.toml": "[package]\nname='x'\n",
  "src/lib.rs": "pub fn a() {}\n",
};

type Step = { run?: string; with?: Record<string, string> };

function kit(ruleId: string, r: Report) {
  const k = fixKitFor(ruleId, r);
  if (!k) throw new Error(`no kit for ${ruleId}`);
  return k;
}

function file(ruleId: string, r: Report, path: string) {
  const f = kit(ruleId, r).files.find((x) => x.path === path);
  if (!f) throw new Error(`no file ${path}`);
  return f.content;
}

function runs(steps: Step[]) {
  return steps.map((s) => s.run).filter(Boolean);
}

describe("fix-kit registry", () => {
  it("only references real rule IDs", () => {
    const ids = new Set(RULES.map((r) => r.id));
    for (const id of RULES_WITH_FIX_KITS) expect(ids.has(id)).toBe(true);
  });

  it("returns null for rules without kits", () => {
    expect(fixKitFor("SEC001", report(TS_APP))).toBeNull();
    expect(fixKitFor("NOPE999", report(TS_APP))).toBeNull();
  });

  it("never emits 'undefined' or empty files", () => {
    for (const spec of [TS_APP, PY_APP, POLYGLOT, { "notes.txt": "x" }]) {
      const r = report(spec);
      for (const id of RULES_WITH_FIX_KITS) {
        const k = fixKitFor(id, r);
        if (!k) continue;
        for (const f of k.files) {
          expect(f.content.length).toBeGreaterThan(0);
          expect(f.content).not.toMatch(/undefined|\[object Object\]/);
        }
        for (const c of k.commands) expect(c).not.toMatch(/undefined/);
      }
    }
  });
});

describe("CI workflow kit", () => {
  it("generates valid, least-privilege YAML for a Node/TypeScript project", () => {
    const yml = parseYaml(file("DX003", report(TS_APP), ".github/workflows/ci.yml"));
    expect(yml.permissions).toEqual({ contents: "read" });
    expect(yml.on.push.branches).toEqual(["main"]);
    expect(runs(yml.jobs.node.steps)).toEqual([
      "npm install",
      "npm run lint --if-present",
      "npm test --if-present",
      "npm run build --if-present",
    ]);
  });

  it("uses npm ci and caching when a lockfile exists, and pnpm via corepack", () => {
    const withLock = parseYaml(file("DX003", report({ ...TS_APP, "package-lock.json": 10 }), ".github/workflows/ci.yml"));
    expect(runs(withLock.jobs.node.steps)).toContain("npm ci");
    expect(withLock.jobs.node.steps[1].with.cache).toBe("npm");
    const pnpm = parseYaml(file("DX003", report({ ...TS_APP, "pnpm-lock.yaml": 10 }), ".github/workflows/ci.yml"));
    expect(runs(pnpm.jobs.node.steps)).toEqual(expect.arrayContaining(["corepack enable", "pnpm install --frozen-lockfile"]));
  });

  it("does not treat a Python lockfile as a Node lockfile", () => {
    const yml = parseYaml(file("DX003", report({ ...TS_APP, "poetry.lock": 10 }), ".github/workflows/ci.yml"));
    expect(runs(yml.jobs.node.steps)).toContain("npm install");
  });

  it("covers Python, Go and Rust with their own jobs", () => {
    const py = parseYaml(file("DX003", report({ ...PY_APP, "requirements.txt": "numpy\n" }), ".github/workflows/ci.yml"));
    expect(runs(py.jobs.python.steps)).toEqual(expect.arrayContaining(["pip install -r requirements.txt", "pytest"]));
    const poly = parseYaml(file("DX003", report(POLYGLOT), ".github/workflows/ci.yml"));
    expect(Object.keys(poly.jobs).sort()).toEqual(["go", "rust"]);
    expect(poly.jobs.go.steps.at(-1).run).toBe("go test ./...");
  });

  it("runs Node steps in a nested package directory", () => {
    const yml = parseYaml(file("DX003", report({ "web/package.json": "{}", "web/src/a.ts": "x" }), ".github/workflows/ci.yml"));
    expect(yml.jobs.node.defaults.run["working-directory"]).toBe("web");
  });

  it("falls back to a skeleton for unknown stacks and sanitizes odd branch names", () => {
    const r = report({ "main.zig": "x" }, { repository: repoInfo({ defaultBranch: "we`ird $(x)" }) });
    const yml = parseYaml(file("DX003", r, ".github/workflows/ci.yml"));
    expect(Object.keys(yml.jobs)).toEqual(["build"]);
    expect(yml.on.push.branches).toEqual(["main"]);
  });

  it("satisfies RepoPilot's own CI and workflow security checks", () => {
    const r = report(TS_APP);
    const after = report({ ...TS_APP, ".github/workflows/ci.yml": file("DX003", r, ".github/workflows/ci.yml") });
    const status = (id: string) => after.checks.find((c) => c.ruleId === id)?.status;
    for (const id of ["DX003", "TST004", "SEC005", "SEC006", "SEC007"]) expect([id, status(id)]).toEqual([id, "pass"]);
  });

  it("TST004 offers a test step for the workflow named in the evidence", () => {
    const r = report({ ...PY_APP, ".github/workflows/build.yml": "on: push\njobs:\n  a:\n    steps:\n      - run: echo hi\n" });
    const k = kit("TST004", r);
    expect(k.files[0]).toMatchObject({ path: ".github/workflows/build.yml", kind: "snippet" });
    expect(k.files[0].content).toContain("- run: pytest");
  });
});

describe("Dependabot kit", () => {
  it("lists every detected ecosystem and nested directories", () => {
    const spec: FileSpec = {
      ...POLYGLOT,
      "package.json": "{}",
      "web/package.json": "{}",
      ".github/workflows/ci.yml": "on: push\njobs:\n  a:\n    steps:\n      - run: go test ./...\n",
    };
    const yml = parseYaml(file("DEP004", report(spec), ".github/dependabot.yml"));
    expect(yml.version).toBe(2);
    const byEco = Object.fromEntries(yml.updates.map((u: { "package-ecosystem": string }) => [u["package-ecosystem"], u]));
    expect(Object.keys(byEco).sort()).toEqual(["cargo", "github-actions", "gomod", "npm"]);
    expect(byEco.npm.directories).toEqual(["/", "/web"]);
    expect(byEco.gomod.directory).toBe("/");
  });
});

describe("community file kits", () => {
  const r = report(TS_APP, { repository: repoInfo({ owner: "acme", name: "widget" }) });

  it("SECURITY.md links to private vulnerability reporting for this repo", () => {
    expect(file("SEC004", r, "SECURITY.md")).toContain("https://github.com/acme/widget/security/advisories/new");
  });

  it("CONTRIBUTING.md uses stack-appropriate commands", () => {
    const md = file("DOC004", r, "CONTRIBUTING.md");
    expect(md).toContain("git clone https://github.com/acme/widget.git");
    expect(md).toContain("npm install");
    expect(md).toContain("`npm test`");
    expect(file("DOC004", report(PY_APP), "CONTRIBUTING.md")).toContain("`pytest`");
  });

  it("LICENSE flags that the choice is a legal decision", () => {
    const k = kit("DOC003", r);
    expect(k.files[0].content).toMatch(/^MIT License\n\nCopyright \(c\) 2026 acme/);
    expect(k.notes.join(" ")).toMatch(/legal decision/);
  });

  it(".gitignore always ignores .env and adds stack-specific entries", () => {
    const node = file("STR001", r, ".gitignore");
    expect(node).toContain(".env\n");
    expect(node).toContain("!.env.example");
    expect(node).toContain("node_modules/");
    expect(node).not.toContain("__pycache__/");
    expect(file("STR001", report(PY_APP), ".gitignore")).toContain("__pycache__/");
  });
});

describe("committed-file kits", () => {
  it("SEC002 untracks each committed env file with quoted paths", () => {
    const k = kit("SEC002", report({ "src/a.py": "x", ".env": "A=1", "api/.env.production": "B=2" }));
    expect(k.commands).toEqual(expect.arrayContaining(["git rm --cached '.env'", "git rm --cached 'api/.env.production'"]));
    expect(k.notes.join(" ")).toMatch(/rotate/);
  });

  it("is not offered when there is nothing to untrack", () => {
    expect(fixKitFor("SEC002", report(TS_APP))).toBeNull();
  });

  it("MNT002 untracks committed dependency directories", () => {
    const k = kit("MNT002", report({ ...TS_APP, "node_modules/x/index.js": 10 }));
    expect(k.commands[0]).toBe("git rm -r --cached 'node_modules'");
  });
});

describe("test, lint and format kits", () => {
  it("offers Vitest for TS and pytest for Python, nothing for unknown stacks", () => {
    expect(kit("TST001", report(TS_APP)).files[0].path).toBe("tests/example.test.ts");
    expect(kit("TST001", report(PY_APP)).files[0].path).toBe("tests/test_example.py");
    expect(fixKitFor("TST001", report({ "main.zig": "x" }))).toBeNull();
  });

  it("ESLint config matches the language", () => {
    expect(file("DX001", report(TS_APP), "eslint.config.mjs")).toContain("typescript-eslint");
    const js = report({ ...TS_APP, "src/index.ts": 0, "src/index.js": "x" }, { languages: { JavaScript: 100 } });
    expect(file("DX001", js, "eslint.config.mjs")).toContain("globals");
    expect(kit("DX001", report(PY_APP)).commands).toContain("ruff check .");
  });

  it("applying the created files makes the targeted checks pass", () => {
    const ids = ["DX003", "DEP004", "SEC004", "DOC004", "DOC003", "STR001", "DX001", "DX002", "TST001"];
    const before = report(TS_APP);
    const created: FileSpec = {};
    for (const id of ids) for (const f of kit(id, before).files) if (f.kind === "create") created[f.path] = f.content;
    const after = report({ ...TS_APP, ...created });
    for (const id of ids) expect([id, after.checks.find((c) => c.ruleId === id)?.status]).toEqual([id, "pass"]);
    expect(after.score.overall!).toBeGreaterThan(before.score.overall!);
  });
});

describe("safePath", () => {
  it("accepts ordinary paths and rejects unsafe ones", () => {
    expect(safePath("api/.env.production")).toBe("api/.env.production");
    for (const bad of ["a b", "x;rm -rf /", "a'b", "a\nb", "../x", "a//b", "$(x)", "`x`", "a/./b"]) expect(safePath(bad)).toBeNull();
  });

  it("excludes unsafe evidence paths from commands", () => {
    const k = kit("SEC002", report({ "src/a.py": "x", ".env": "A=1", "evil dir/.env": "B=2" }));
    expect(k.commands.some((c) => c.includes("evil"))).toBe(false);
  });
});

describe("pyproject.toml handling", () => {
  it("offers pyproject.toml as a new file when the repo has none, and as a snippet otherwise", () => {
    for (const id of ["TST001", "DX001", "DX002"]) {
      expect(kit(id, report(PY_APP)).files.find((f) => f.path === "pyproject.toml")?.kind).toBe("create");
      const withPy = report({ ...PY_APP, "pyproject.toml": "[project]\nname='x'\n" });
      expect(kit(id, withPy).files.find((f) => f.path === "pyproject.toml")?.kind).toBe("snippet");
    }
  });

  it("the created pyproject.toml parses as TOML-like key/value sections", () => {
    const content = kit("DX001", report(PY_APP)).files[0].content;
    expect(content).toMatch(/^\[tool\.ruff\]\nline-length = 100\n/);
  });
});
