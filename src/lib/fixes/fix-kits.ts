import type { Report } from "@/lib/reports/schema";

/**
 * Fix-it kits: ready-to-commit starter files and commands for common findings,
 * tailored to the detected stack. Pure and deterministic — built only from the report.
 *
 * Every repository-derived value (paths, names) is sanitized before being placed in a
 * template, because file names in a repository are untrusted input. Commands are shown
 * to the user to run themselves; RepoPilot never executes them.
 */

export type FixFile = {
  path: string;
  /** "create": a new file. "snippet": content to merge into an existing file. */
  kind: "create" | "snippet";
  content: string;
};

export type FixKit = {
  ruleId: string;
  title: string;
  files: FixFile[];
  /** Shell commands for the user to run locally (never executed by RepoPilot). */
  commands: string[];
  notes: string[];
};

// ---------- sanitizing ----------

const SAFE_PATH_RE = /^[A-Za-z0-9._\-/]+$/;

/** Returns the path if it only contains safe characters and no traversal, else null. */
export function safePath(path: string): string | null {
  if (!SAFE_PATH_RE.test(path) || path.length > 200) return null;
  if (path.split("/").some((s) => s === "" || s === "." || s === "..")) return null;
  return path;
}

/** Default branch name if it is plain, else "main" (it is inserted into YAML and Markdown). */
function branchOf(report: Report): string {
  return /^[A-Za-z0-9._\-/]{1,100}$/.test(report.repository.defaultBranch) ? report.repository.defaultBranch : "main";
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "." : path.slice(0, i);
}

/** Single-quotes a path for POSIX shells. Inputs are already restricted by safePath. */
function sh(path: string): string {
  return `'${path}'`;
}

// ---------- stack helpers ----------

type Stack = {
  node: boolean;
  typescript: boolean;
  python: boolean;
  go: boolean;
  rust: boolean;
  ruby: boolean;
  maven: boolean;
  gradle: boolean;
  nodeManager: "npm" | "pnpm" | "yarn";
  hasNodeLockfile: boolean;
  nodeDir: string;
  pythonDir: string;
  hasRequirements: boolean;
  hasPyproject: boolean;
  rspec: boolean;
  testFrameworks: string[];
};

function firstManifestDir(report: Report, names: string[]): string | null {
  const m = report.stack.manifests.find((x) => names.includes(x.path.split("/").pop()!.toLowerCase()));
  if (!m) return null;
  const p = safePath(m.path);
  return p ? dirOf(p) : null;
}

export function describeStack(report: Report): Stack {
  const eco = report.stack.ecosystems;
  const langs = report.stack.languages.map((l) => l.name);
  const pms = report.stack.packageManagers.map((p) => p.name);
  const manifests = report.stack.manifests.map((m) => m.path.split("/").pop()!.toLowerCase());
  const nodeManager = pms.includes("pnpm") ? "pnpm" : pms.includes("Yarn") ? "yarn" : "npm";
  return {
    node: eco.some((e) => e.startsWith("JavaScript")),
    typescript: langs.includes("TypeScript"),
    // Many Python projects (scripts, research code) have no manifest, so language share counts too.
    // Other toolchains need their manifest for the generated commands to work.
    python: eco.includes("Python") || report.stack.languages.some((l) => l.name === "Python" && l.percent >= 10),
    go: eco.includes("Go"),
    rust: eco.includes("Rust"),
    ruby: eco.includes("Ruby"),
    maven: eco.includes("Java (Maven)"),
    gradle: eco.includes("JVM (Gradle)"),
    nodeManager,
    hasNodeLockfile: report.stack.packageManagers.some(
      (p) => ["npm", "pnpm", "Yarn"].includes(p.name) && /lock|shrinkwrap/.test(p.evidence),
    ),
    nodeDir: firstManifestDir(report, ["package.json"]) ?? ".",
    pythonDir: firstManifestDir(report, ["pyproject.toml", "requirements.txt", "setup.py", "pipfile"]) ?? ".",
    hasRequirements: manifests.includes("requirements.txt"),
    hasPyproject: manifests.includes("pyproject.toml"),
    rspec: report.stack.testFrameworks.some((t) => t.name === "RSpec"),
    testFrameworks: report.stack.testFrameworks.map((t) => t.name),
  };
}

function nodeRun(s: Stack, script: string): string {
  if (s.nodeManager === "pnpm") return `pnpm run --if-present ${script}`;
  if (s.nodeManager === "yarn") return `yarn run ${script}`;
  return `npm run ${script} --if-present`;
}

function nodeInstall(s: Stack): string {
  if (s.nodeManager === "pnpm") return "pnpm install --frozen-lockfile";
  if (s.nodeManager === "yarn") return "yarn install";
  return s.hasNodeLockfile ? "npm ci" : "npm install";
}

function workingDir(dir: string): string[] {
  return dir === "." ? [] : ["    defaults:", "      run:", `        working-directory: ${dir}`];
}

// ---------- CI workflow ----------

function ciJobs(s: Stack): { jobs: string[]; covered: string[] } {
  const jobs: string[] = [];
  const covered: string[] = [];

  if (s.node) {
    covered.push("Node.js");
    const steps = [
      "      - uses: actions/checkout@v4",
      "      - uses: actions/setup-node@v4",
      "        with:",
      "          node-version: 24",
      ...(s.nodeManager === "npm" && s.hasNodeLockfile
        ? ["          cache: npm", ...(s.nodeDir !== "." ? [`          cache-dependency-path: ${s.nodeDir}/package-lock.json`] : [])]
        : []),
      ...(s.nodeManager !== "npm" ? ["      - run: corepack enable"] : []),
      `      - run: ${nodeInstall(s)}`,
      `      - run: ${nodeRun(s, "lint")}`,
      `      - run: ${s.nodeManager === "npm" ? "npm test --if-present" : nodeRun(s, "test")}`,
      `      - run: ${nodeRun(s, "build")}`,
    ];
    jobs.push(["  node:", "    runs-on: ubuntu-latest", ...workingDir(s.nodeDir), "    steps:", ...steps].join("\n"));
  }

  if (s.python) {
    covered.push("Python");
    const install = s.hasRequirements
      ? "pip install -r requirements.txt"
      : s.hasPyproject
        ? "pip install ."
        : "echo 'Add your dependency install step here'";
    jobs.push(
      [
        "  python:",
        "    runs-on: ubuntu-latest",
        ...workingDir(s.pythonDir),
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-python@v5",
        "        with:",
        '          python-version: "3.12"',
        "      - run: python -m pip install --upgrade pip",
        `      - run: ${install}`,
        "      - run: pip install pytest",
        "      - run: pytest",
      ].join("\n"),
    );
  }

  if (s.go) {
    covered.push("Go");
    jobs.push(
      [
        "  go:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-go@v5",
        "        with:",
        "          go-version-file: go.mod",
        "      - run: go vet ./...",
        "      - run: go test ./...",
      ].join("\n"),
    );
  }

  if (s.rust) {
    covered.push("Rust");
    jobs.push(
      [
        "  rust:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      # rustup and cargo are preinstalled on GitHub-hosted Ubuntu runners.",
        "      - run: cargo build --verbose",
        "      - run: cargo test --verbose",
      ].join("\n"),
    );
  }

  if (s.maven || s.gradle) {
    covered.push("Java");
    jobs.push(
      [
        "  java:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-java@v4",
        "        with:",
        "          distribution: temurin",
        '          java-version: "21"',
        s.maven ? "      - run: mvn --batch-mode verify" : "      - run: ./gradlew build",
      ].join("\n"),
    );
  }

  if (s.ruby) {
    covered.push("Ruby");
    jobs.push(
      [
        "  ruby:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      # Third-party action maintained by the Ruby core team; consider pinning it to a commit SHA.",
        "      - uses: ruby/setup-ruby@v1",
        "        with:",
        "          bundler-cache: true",
        `      - run: ${s.rspec ? "bundle exec rspec" : "bundle exec rake test"}`,
      ].join("\n"),
    );
  }

  return { jobs, covered };
}

function ciWorkflow(report: Report): FixKit {
  const s = describeStack(report);
  const { jobs, covered } = ciJobs(s);
  const branch = branchOf(report);
  const body = jobs.length
    ? jobs.join("\n\n")
    : [
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      # RepoPilot couldn't detect a supported stack. Replace these with your build and test commands.",
        "      - run: echo 'build'",
        "      - run: echo 'test'",
      ].join("\n");
  const content = [
    "name: CI",
    "",
    "on:",
    "  push:",
    `    branches: [${branch}]`,
    "  pull_request:",
    "",
    "# Least privilege: the workflow only needs to read the code.",
    "permissions:",
    "  contents: read",
    "",
    "jobs:",
    body,
    "",
  ].join("\n");
  const notes = [
    covered.length
      ? `Generated for the detected stack: ${covered.join(", ")}.`
      : "No supported stack was detected; the workflow is a skeleton.",
    "Steps use --if-present (npm/pnpm) so missing scripts are skipped; remove steps you don't need.",
    "Run it once on a branch and adjust commands if your project uses different ones.",
  ];
  if (s.python && !s.testFrameworks.includes("pytest"))
    notes.push("The Python job runs pytest; add tests (see TST001) or replace that step.");
  return {
    ruleId: "DX003",
    title: "GitHub Actions CI workflow",
    files: [{ path: ".github/workflows/ci.yml", kind: "create", content }],
    commands: ["git add .github/workflows/ci.yml", 'git commit -m "Add CI workflow"'],
    notes,
  };
}

function ciTestStep(report: Report): FixKit {
  const s = describeStack(report);
  const steps: string[] = [];
  if (s.node) steps.push(`      - run: ${s.nodeManager === "npm" ? "npm test" : nodeRun(s, "test")}`);
  if (s.python) steps.push("      - run: pip install pytest", "      - run: pytest");
  if (s.go) steps.push("      - run: go test ./...");
  if (s.rust) steps.push("      - run: cargo test");
  if (s.maven) steps.push("      - run: mvn --batch-mode test");
  if (s.gradle) steps.push("      - run: ./gradlew test");
  if (s.ruby) steps.push(`      - run: ${s.rspec ? "bundle exec rspec" : "bundle exec rake test"}`);
  if (steps.length === 0) steps.push("      - run: echo 'replace with your test command'");
  const workflow = report.findings
    .find((f) => f.ruleId === "TST004")
    ?.evidence.map((e) => e.path && safePath(e.path))
    .find(Boolean);
  return {
    ruleId: "TST004",
    title: "Test step for your existing CI",
    files: [{ path: workflow || ".github/workflows/<your-workflow>.yml", kind: "snippet", content: steps.join("\n") + "\n" }],
    commands: [],
    notes: ["Add these lines at the end of the job's steps list, after dependencies are installed."],
  };
}

// ---------- Dependabot ----------

const DEPENDABOT_ECOSYSTEMS: [string, string][] = [
  ["package.json", "npm"],
  ["requirements.txt", "pip"],
  ["pyproject.toml", "pip"],
  ["setup.py", "pip"],
  ["pipfile", "pip"],
  ["go.mod", "gomod"],
  ["cargo.toml", "cargo"],
  ["gemfile", "bundler"],
  ["composer.json", "composer"],
  ["pom.xml", "maven"],
  ["build.gradle", "gradle"],
  ["build.gradle.kts", "gradle"],
  ["pubspec.yaml", "pub"],
  ["mix.exs", "mix"],
];

function dependabot(report: Report): FixKit {
  const byEcosystem = new Map<string, Set<string>>();
  for (const m of report.stack.manifests) {
    const p = safePath(m.path);
    if (!p) continue;
    const base = p.split("/").pop()!.toLowerCase();
    const eco = DEPENDABOT_ECOSYSTEMS.find(([name]) => name === base)?.[1] ?? (base.endsWith(".csproj") ? "nuget" : null);
    if (!eco) continue;
    const dir = dirOf(p) === "." ? "/" : `/${dirOf(p)}`;
    byEcosystem.set(eco, (byEcosystem.get(eco) ?? new Set()).add(dir));
  }
  const hasWorkflows = report.checks.some((c) => c.ruleId === "DX003" && c.status === "pass" && /GitHub Actions/.test(c.summary));
  if (hasWorkflows) byEcosystem.set("github-actions", new Set(["/"]));

  const entries = [...byEcosystem].map(([eco, dirs]) => {
    const list = [...dirs].sort().slice(0, 10);
    const dirLines = list.length === 1 ? [`    directory: "${list[0]}"`] : ["    directories:", ...list.map((d) => `      - "${d}"`)];
    return [
      `  - package-ecosystem: ${eco}`,
      ...dirLines,
      "    schedule:",
      `      interval: ${eco === "github-actions" ? "monthly" : "weekly"}`,
      "    open-pull-requests-limit: 5",
    ].join("\n");
  });
  const content = [
    "version: 2",
    "updates:",
    ...(entries.length ? entries : ["  # No supported manifests were detected; add an entry per ecosystem."]),
    "",
  ].join("\n");
  return {
    ruleId: "DEP004",
    title: "Dependabot configuration",
    files: [{ path: ".github/dependabot.yml", kind: "create", content }],
    commands: ["git add .github/dependabot.yml", 'git commit -m "Enable Dependabot version updates"'],
    notes: [
      "Dependabot is free on GitHub. Updates arrive as pull requests that your CI can verify.",
      "Also enable Dependabot security updates in Settings → Code security.",
    ],
  };
}

// ---------- community files ----------

function securityPolicy(report: Report): FixKit {
  const { owner, name } = report.repository;
  const content = `# Security policy

## Reporting a vulnerability

Please **do not** report security vulnerabilities through public GitHub issues.

Report them privately through GitHub's private vulnerability reporting:
https://github.com/${owner}/${name}/security/advisories/new

Please include:

- a description of the issue and its impact,
- steps to reproduce or a proof of concept,
- affected versions or commits.

You can expect an acknowledgement within a few days. We'll keep you informed while we investigate and fix the issue, and credit you in the release notes if you wish.

## Supported versions

Security fixes are applied to the latest release on the \`${branchOf(report)}\` branch.
`;
  return {
    ruleId: "SEC004",
    title: "SECURITY.md",
    files: [{ path: "SECURITY.md", kind: "create", content }],
    commands: ["git add SECURITY.md", 'git commit -m "Add security policy"'],
    notes: [
      "Turn on private vulnerability reporting: Settings → Code security → Private vulnerability reporting → Enable.",
      "Adjust the response time and supported versions to what you can realistically commit to.",
    ],
  };
}

function setupCommands(s: Stack): { install: string; test: string } {
  if (s.node)
    return {
      install: nodeInstall(s).replace("npm ci", "npm install"),
      test: s.nodeManager === "npm" ? "npm test" : `${s.nodeManager} test`,
    };
  if (s.python)
    return {
      install: s.hasRequirements ? "pip install -r requirements.txt" : s.hasPyproject ? 'pip install -e ".[dev]"' : "pip install ...",
      test: "pytest",
    };
  if (s.go) return { install: "go mod download", test: "go test ./..." };
  if (s.rust) return { install: "cargo build", test: "cargo test" };
  if (s.maven) return { install: "mvn --batch-mode install -DskipTests", test: "mvn test" };
  if (s.gradle) return { install: "./gradlew build -x test", test: "./gradlew test" };
  if (s.ruby) return { install: "bundle install", test: s.rspec ? "bundle exec rspec" : "bundle exec rake test" };
  return { install: "<install dependencies>", test: "<run the tests>" };
}

function contributing(report: Report): FixKit {
  const s = describeStack(report);
  const { install, test } = setupCommands(s);
  const { owner, name } = report.repository;
  const content = `# Contributing to ${name}

Thanks for your interest in contributing!

## Getting started

\`\`\`bash
git clone https://github.com/${owner}/${name}.git
cd ${name}
${install}
\`\`\`

## Making changes

1. Create a branch: \`git checkout -b my-change\`.
2. Make your change and add or update tests.
3. Run the tests: \`${test}\`.
4. Commit with a clear message and open a pull request against \`${branchOf(report)}\`.

## Reporting bugs and requesting features

Open an issue describing what you expected, what happened, and how to reproduce it.
For security issues, follow SECURITY.md instead of opening a public issue.
`;
  return {
    ruleId: "DOC004",
    title: "CONTRIBUTING.md",
    files: [{ path: "CONTRIBUTING.md", kind: "create", content }],
    commands: ["git add CONTRIBUTING.md", 'git commit -m "Add contribution guide"'],
    notes: ["Commands are inferred from the detected stack; check they match how you actually build and test."],
  };
}

function license(report: Report): FixKit {
  const year = new Date(report.generatedAt).getUTCFullYear();
  const holder = report.repository.owner;
  const content = `MIT License

Copyright (c) ${year} ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
  return {
    ruleId: "DOC003",
    title: "LICENSE (MIT example)",
    files: [{ path: "LICENSE", kind: "create", content }],
    commands: ["git add LICENSE", 'git commit -m "Add license"'],
    notes: [
      "Choosing a license is a legal decision. MIT is one common permissive option; compare alternatives at https://choosealicense.com.",
      `Replace "${holder}" with the legal name of the copyright holder if different.`,
    ],
  };
}

// ---------- .gitignore and committed files ----------

const GITIGNORE_BLOCKS: { when: (s: Stack) => boolean; lines: string[] }[] = [
  {
    when: () => true,
    lines: [
      "# Secrets and local environment",
      ".env",
      ".env.*",
      "!.env.example",
      "",
      "# OS and editor files",
      ".DS_Store",
      "Thumbs.db",
      ".idea/",
      ".vscode/*",
      "!.vscode/extensions.json",
    ],
  },
  { when: (s) => s.node, lines: ["", "# Node.js", "node_modules/", "dist/", "build/", "coverage/", ".next/", "*.log"] },
  {
    when: (s) => s.python,
    lines: [
      "",
      "# Python",
      "__pycache__/",
      "*.py[cod]",
      ".venv/",
      "venv/",
      ".pytest_cache/",
      ".mypy_cache/",
      ".ruff_cache/",
      "*.egg-info/",
      "dist/",
      "build/",
    ],
  },
  { when: (s) => s.go, lines: ["", "# Go", "/bin/", "*.exe", "*.test", "*.out"] },
  { when: (s) => s.rust, lines: ["", "# Rust", "/target/"] },
  { when: (s) => s.maven || s.gradle, lines: ["", "# Java", "target/", ".gradle/", "build/", "*.class"] },
  { when: (s) => s.ruby, lines: ["", "# Ruby", "/.bundle/", "/vendor/bundle/", "/log/", "/tmp/"] },
];

function gitignoreContent(s: Stack): string {
  return GITIGNORE_BLOCKS.filter((b) => b.when(s))
    .flatMap((b) => b.lines)
    .join("\n")
    .concat("\n");
}

function gitignore(report: Report): FixKit {
  return {
    ruleId: "STR001",
    title: ".gitignore",
    files: [{ path: ".gitignore", kind: "create", content: gitignoreContent(describeStack(report)) }],
    commands: ["git add .gitignore", 'git commit -m "Add .gitignore"'],
    notes: ["More templates per language: https://github.com/github/gitignore"],
  };
}

function evidencePaths(report: Report, ruleId: string): string[] {
  const out: string[] = [];
  for (const f of report.findings.filter((x) => x.ruleId === ruleId)) {
    for (const e of f.evidence) {
      const p = e.path && safePath(e.path);
      if (p && !out.includes(p)) out.push(p);
    }
  }
  return out;
}

function untrackEnvFiles(report: Report): FixKit | null {
  const paths = evidencePaths(report, "SEC002");
  if (paths.length === 0) return null;
  return {
    ruleId: "SEC002",
    title: "Stop tracking environment files",
    files: [
      { path: ".gitignore", kind: "snippet", content: ".env\n.env.*\n!.env.example\n" },
      { path: ".env.example", kind: "create", content: "# Copy to .env and fill in real values. Never commit .env.\n# EXAMPLE_API_KEY=\n" },
    ],
    commands: [
      ...paths.map((p) => `git rm --cached ${sh(p)}`),
      "git add .gitignore .env.example",
      'git commit -m "Stop tracking environment files"',
    ],
    notes: [
      "git rm --cached removes the file from Git but keeps your local copy.",
      "Any secret that was ever committed is still in Git history: rotate it at the provider first.",
    ],
  };
}

function untrackDependencyDirs(report: Report): FixKit | null {
  const paths = evidencePaths(report, "MNT002");
  if (paths.length === 0) return null;
  return {
    ruleId: "MNT002",
    title: "Stop tracking dependency and cache files",
    files: [{ path: ".gitignore", kind: "snippet", content: gitignoreContent(describeStack(report)) }],
    commands: [...paths.map((p) => `git rm -r --cached ${sh(p)}`), "git add .gitignore", 'git commit -m "Stop tracking generated files"'],
    notes: ["Your local files are kept; only Git stops tracking them."],
  };
}

// ---------- tests, linting, formatting ----------

function testStarter(report: Report, ruleId: "TST001" | "TST002"): FixKit | null {
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

function npmTestScript(): FixKit {
  return {
    ruleId: "TST003",
    title: "package.json test script",
    files: [{ path: "package.json", kind: "snippet", content: '"scripts": {\n  "test": "vitest run"\n}\n' }],
    commands: [],
    notes: ['Replace "vitest run" with the command for your test runner (e.g. "jest", "mocha", "node --test").'],
  };
}

function linter(report: Report): FixKit | null {
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

function formatter(report: Report): FixKit | null {
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

function npmScripts(): FixKit {
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

function lockfile(report: Report): FixKit | null {
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

function pythonManifest(report: Report): FixKit | null {
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

// ---------- registry ----------

type Builder = (report: Report) => FixKit | null;

const BUILDERS: Record<string, Builder> = {
  DX003: ciWorkflow,
  TST004: ciTestStep,
  DEP004: dependabot,
  SEC004: securityPolicy,
  DOC004: contributing,
  DOC003: license,
  STR001: gitignore,
  SEC002: untrackEnvFiles,
  MNT002: untrackDependencyDirs,
  TST001: (r) => testStarter(r, "TST001"),
  TST002: (r) => testStarter(r, "TST002"),
  TST003: npmTestScript,
  DX001: linter,
  DX002: formatter,
  DX004: npmScripts,
  DEP001: lockfile,
  STR002: pythonManifest,
};

export const RULES_WITH_FIX_KITS = Object.keys(BUILDERS);

/** Returns a fix-it kit for a rule if one applies to this report, else null. */
export function fixKitFor(ruleId: string, report: Report): FixKit | null {
  const builder = BUILDERS[ruleId];
  if (!builder) return null;
  const kit = builder(report);
  if (!kit) return null;
  return { ...kit, files: kit.files.filter((f) => f.path.length > 0) };
}
