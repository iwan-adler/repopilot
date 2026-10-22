/** CI workflow and Dependabot configuration kits. */
import type { Report } from "@/lib/reports/schema";
import { type FixKit, safePath, branchOf, dirOf, type Stack, describeStack, nodeRun, nodeInstall, workingDir } from "./shared";

export function ciJobs(s: Stack): { jobs: string[]; covered: string[] } {
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

export function ciWorkflow(report: Report): FixKit {
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

export function ciTestStep(report: Report): FixKit {
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

export const DEPENDABOT_ECOSYSTEMS: [string, string][] = [
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

export function dependabot(report: Report): FixKit {
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
