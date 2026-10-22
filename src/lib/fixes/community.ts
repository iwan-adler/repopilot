/** Community file kits: SECURITY.md, CONTRIBUTING.md, LICENSE, .gitignore, and untracking committed files. */
import type { Report } from "@/lib/reports/schema";
import { type FixKit, safePath, branchOf, sh, type Stack, describeStack, nodeInstall } from "./shared";

export function securityPolicy(report: Report): FixKit {
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

export function setupCommands(s: Stack): { install: string; test: string } {
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

export function contributing(report: Report): FixKit {
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

export function license(report: Report): FixKit {
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

export const GITIGNORE_BLOCKS: { when: (s: Stack) => boolean; lines: string[] }[] = [
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

export function gitignoreContent(s: Stack): string {
  return GITIGNORE_BLOCKS.filter((b) => b.when(s))
    .flatMap((b) => b.lines)
    .join("\n")
    .concat("\n");
}

export function gitignore(report: Report): FixKit {
  return {
    ruleId: "STR001",
    title: ".gitignore",
    files: [{ path: ".gitignore", kind: "create", content: gitignoreContent(describeStack(report)) }],
    commands: ["git add .gitignore", 'git commit -m "Add .gitignore"'],
    notes: ["More templates per language: https://github.com/github/gitignore"],
  };
}

export function evidencePaths(report: Report, ruleId: string): string[] {
  const out: string[] = [];
  for (const f of report.findings.filter((x) => x.ruleId === ruleId)) {
    for (const e of f.evidence) {
      const p = e.path && safePath(e.path);
      if (p && !out.includes(p)) out.push(p);
    }
  }
  return out;
}

export function untrackEnvFiles(report: Report): FixKit | null {
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

export function untrackDependencyDirs(report: Report): FixKit | null {
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
