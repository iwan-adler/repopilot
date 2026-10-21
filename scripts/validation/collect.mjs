#!/usr/bin/env node
/**
 * Accuracy study data collection (see docs/VALIDATION.md).
 *
 * For each repository it records:
 *   1. RepoPilot's report from a deployed instance (POST /api/analyze),
 *   2. GitHub's community profile (independent: README / LICENSE / CONTRIBUTING detection),
 *   3. OpenSSF Scorecard results (independent: License, Security-Policy, Dangerous-Workflow, ...).
 *
 * Usage:  node scripts/validation/collect.mjs [baseUrl]
 * Requests are spaced to respect RepoPilot's per-IP rate limit. No tokens are required.
 */
import { mkdir, writeFile } from "node:fs/promises";

const BASE = process.argv[2] ?? "https://repopilot-rho.vercel.app";
const SPACING_MS = 65_000;

export const REPOS = [
  // JavaScript / TypeScript
  "expressjs/express",
  "sindresorhus/ky",
  "axios/axios",
  "vercel/swr",
  "chalk/chalk",
  // Python
  "pallets/flask",
  "psf/requests",
  "karpathy/nanoGPT",
  "fastapi/fastapi",
  "httpie/cli",
  // Go
  "spf13/cobra",
  "gin-gonic/gin",
  "junegunn/fzf",
  // Rust
  "BurntSushi/ripgrep",
  "sharkdp/bat",
  "serde-rs/serde",
  // Java
  "google/gson",
  "square/okhttp",
  // Ruby
  "sinatra/sinatra",
  "rubocop/rubocop",
  // PHP
  "laravel/laravel",
  "guzzle/guzzle",
  // C / C++
  "redis/redis",
  "nlohmann/json",
  // Documentation / notebooks
  "public-apis/public-apis",
  "jakevdp/PythonDataScienceHandbook",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, init) {
  const res = await fetch(url, { ...init, headers: { "User-Agent": "RepoPilot-validation", ...(init?.headers ?? {}) } });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body, retryAfter: Number(res.headers.get("retry-after")) || 0 };
}

async function analyze(repo) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await getJson(`${BASE}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: repo }),
    });
    if (r.status === 429 || r.status === 503) {
      const wait = Math.max(r.retryAfter, 30) * 1000;
      console.log(`  ${repo}: ${r.status}, retrying in ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    return r;
  }
  return { status: 0, body: { error: "gave up after retries" } };
}

function summarize(report) {
  return {
    id: report.id,
    engineVersion: report.engineVersion,
    commitSha: report.repository.commitSha,
    score: report.score.overall,
    band: report.score.band,
    primaryLanguage: report.stack.primaryLanguage,
    checks: report.checks.map((c) => ({ ruleId: c.ruleId, status: c.status, summary: c.summary })),
    findings: report.findings.map((f) => ({
      ruleId: f.ruleId,
      severity: f.severity,
      confidence: f.confidence,
      title: f.title,
      evidence: f.evidence.slice(0, 8),
    })),
  };
}

const results = [];
for (const [i, repo] of REPOS.entries()) {
  const started = Date.now();
  const a = await analyze(repo);
  const community = await getJson(`https://api.github.com/repos/${repo}/community/profile`);
  const scorecard = await getJson(`https://api.securityscorecards.dev/projects/github.com/${repo}`);
  const files = community.body?.files ?? {};
  results.push({
    repo,
    repopilot: a.status === 200 ? summarize(a.body.report) : { error: a.body?.error ?? a.status },
    community:
      community.status === 200
        ? {
            readme: Boolean(files.readme),
            license: Boolean(files.license),
            contributing: files.contributing?.html_url ?? null,
          }
        : { error: community.status },
    scorecard:
      scorecard.status === 200
        ? {
            date: scorecard.body.date,
            commit: scorecard.body.repo?.commit,
            checks: Object.fromEntries(scorecard.body.checks.map((c) => [c.name, { score: c.score, reason: c.reason }])),
          }
        : { error: scorecard.status },
  });
  console.log(`[${i + 1}/${REPOS.length}] ${repo}: RepoPilot ${a.status}, community ${community.status}, scorecard ${scorecard.status}`);
  if (i < REPOS.length - 1) await sleep(Math.max(0, SPACING_MS - (Date.now() - started)));
}

await mkdir("docs/validation", { recursive: true });
await writeFile(
  "docs/validation/results.json",
  JSON.stringify({ collectedAt: new Date().toISOString(), base: BASE, results }, null, 2) + "\n",
);
console.log("Wrote docs/validation/results.json");
