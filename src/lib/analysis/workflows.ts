/**
 * Line-based heuristics over GitHub Actions workflow YAML. These are deliberately
 * conservative text checks (no YAML evaluation) and are labelled as heuristics.
 */

export function isWorkflowPath(path: string): boolean {
  return /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path);
}

const CI_CONFIG_PATTERNS: [RegExp, string][] = [
  [/^\.github\/workflows\/[^/]+\.ya?ml$/i, "GitHub Actions"],
  [/^\.gitlab-ci\.ya?ml$/i, "GitLab CI"],
  [/^\.circleci\/config\.ya?ml$/i, "CircleCI"],
  [/^\.travis\.ya?ml$/i, "Travis CI"],
  [/^azure-pipelines\.ya?ml$/i, "Azure Pipelines"],
  [/^jenkinsfile$/i, "Jenkins"],
  [/^bitbucket-pipelines\.ya?ml$/i, "Bitbucket Pipelines"],
  [/^\.drone\.ya?ml$/i, "Drone CI"],
  [/^\.woodpecker(\.ya?ml|\/[^/]+\.ya?ml)$/i, "Woodpecker CI"],
  [/^appveyor\.ya?ml$/i, "AppVeyor"],
  [/^\.buildkite\/pipeline\.ya?ml$/i, "Buildkite"],
];

export function ciSystemFor(path: string): string | null {
  for (const [re, name] of CI_CONFIG_PATTERNS) if (re.test(path)) return name;
  return null;
}

export function usesPullRequestTarget(text: string): boolean {
  return /(^|[\s\[,{])pull_request_target\b/m.test(text.replace(/#.*$/gm, ""));
}

/** pull_request_target combined with checking out untrusted PR head code. */
export function checksOutPullRequestHead(text: string): number | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/\bref:\s*\$\{\{\s*(github\.event\.pull_request\.head\.(sha|ref)|github\.head_ref)\s*\}\}/.test(lines[i])) {
      return i + 1;
    }
  }
  return null;
}

/** Untrusted event fields that attackers can control (per GitHub's security hardening guide). */
const UNTRUSTED_EXPR =
  /\$\{\{\s*(github\.event\.(issue\.(title|body)|pull_request\.(title|body|head\.ref|head\.label|head\.repo\.default_branch)|comment\.body|review\.body|review_comment\.body|discussion\.(title|body)|pages\.[^}]*\.page_name|commits\.[^}]*\.(message|author\.(email|name))|head_commit\.(message|author\.(email|name)))|github\.head_ref)\s*\}\}/;

/**
 * Finds untrusted expressions interpolated directly into `run:` shell scripts or
 * `script:` (actions/github-script) blocks. Returns 1-based line numbers.
 */
export function findScriptInjections(text: string): number[] {
  const lines = text.split(/\r?\n/);
  const hits: number[] = [];
  let blockIndent: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = line.length - line.trimStart().length;
    if (blockIndent !== null) {
      if (line.trim() === "" || indent > blockIndent) {
        if (UNTRUSTED_EXPR.test(line)) hits.push(i + 1);
        continue;
      }
      blockIndent = null;
    }
    const m = /^(\s*)(?:-\s+)?(run|script):\s*(.*)$/.exec(line);
    if (m) {
      const keyIndent = m[1].length + (line.trimStart().startsWith("-") ? 2 : 0);
      const rest = m[3];
      if (/^[|>][-+]?\s*$/.test(rest)) {
        blockIndent = keyIndent;
      } else if (UNTRUSTED_EXPR.test(rest)) {
        hits.push(i + 1);
      }
    }
  }
  return hits;
}

/** Third-party actions referenced by a mutable tag/branch rather than a full commit SHA. */
export function findUnpinnedActions(text: string): { line: number; ref: string }[] {
  const out: { line: number; ref: string }[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(?:-\s+)?uses:\s*["']?([^"'\s#]+)["']?/.exec(lines[i]);
    if (!m) continue;
    const ref = m[1];
    if (ref.startsWith("./") || ref.startsWith("docker://")) continue;
    const at = ref.lastIndexOf("@");
    if (at === -1) continue;
    const action = ref.slice(0, at);
    const version = ref.slice(at + 1);
    const owner = action.split("/")[0].toLowerCase();
    if (owner === "actions" || owner === "github") continue; // first-party GitHub actions
    if (/^[0-9a-f]{40}$/.test(version)) continue;
    out.push({ line: i + 1, ref });
  }
  return out;
}

const TEST_COMMAND_RE =
  /\b(npm (run )?test|npm run test:|npm t\b|yarn (run )?test|pnpm (run )?test|bun (run )?test|npx (vitest|jest|playwright test)|vitest|jest\b|pytest|python -m (pytest|unittest)|tox\b|nox\b|go test|cargo (test|nextest)|cross test|mvn\b.*\b(test|verify)|gradlew?\b.*\b(test|check)\b|bundle exec (rspec|rake)|rspec\b|rake test|phpunit|pest\b|artisan test|composer (run )?test|dotnet test|mix test|flutter test|deno test|swift test|ctest\b|make (test|tests|check|ci)\b)/i;

/** Custom runners and toolchains invoked through variables, e.g. `./runtest`, `${{ env.CARGO }} test`. */
const CUSTOM_TEST_RE = /(^|[\s/])\.?\/?run[-_]?tests?(\.sh)?\b|\}\}\s+test\b|\btest\.sh\b/i;

/** A step or job explicitly named as a test step: `- name: Run tests`, `name: test`, a `tests:` job. */
const TEST_NAME_RE = /^\s*(-\s+)?name:\s*["']?[^"'#]*\btests?\b/i;
const TEST_JOB_RE = /^ {2}tests?(-[\w-]+)?:\s*$/i;
/** Steps or jobs about publishing are not test runs even if they contain the word ("test-pypi"). */
const NOT_TESTS_RE = /pypi|publish|release|deploy|upload/i;

/**
 * Returns the 1-based line of the first evidence that a CI file runs tests: a known test
 * command, a custom test runner, or a step/job named as tests. Heuristic (medium confidence).
 */
export function findTestCommand(text: string): number | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s#.*$/, "").replace(/^\s*#.*$/, "");
    if (!line.trim() || NOT_TESTS_RE.test(line)) continue;
    if (TEST_COMMAND_RE.test(line) || CUSTOM_TEST_RE.test(line) || TEST_NAME_RE.test(line) || TEST_JOB_RE.test(line)) return i + 1;
  }
  return null;
}
