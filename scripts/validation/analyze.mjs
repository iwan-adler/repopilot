#!/usr/bin/env node
/**
 * Compares RepoPilot results with independent sources (docs/VALIDATION.md).
 *
 * Usage: node scripts/validation/analyze.mjs [docs/validation/results.json]
 * Prints Markdown: agreement tables, every disagreement, and the findings that need manual review.
 */
import { readFile } from "node:fs/promises";

const file = process.argv[2] ?? "docs/validation/results.json";
const { results, collectedAt, base } = JSON.parse(await readFile(file, "utf8"));

/** RepoPilot status → "ok" | "issue" | null (excluded). */
function rp(r, ruleId) {
  const c = r.repopilot.checks?.find((x) => x.ruleId === ruleId);
  if (!c) return null;
  if (c.status === "pass") return "ok";
  if (c.status === "fail" || c.status === "warn") return "issue";
  return null;
}

/** Scorecard check → "ok" | "issue" | null (inconclusive or missing). */
function sc(r, name, okWhen = (s) => s === 10) {
  const c = r.scorecard.checks?.[name];
  if (!c || c.score < 0) return null;
  return okWhen(c.score) ? "ok" : "issue";
}

const comparisons = [
  {
    id: "DOC001",
    label: "README present",
    source: "GitHub community profile",
    other: (r) => (r.community.error ? null : r.community.readme ? "ok" : "issue"),
  },
  {
    id: "DOC003",
    label: "License declared",
    source: "GitHub community profile",
    other: (r) => (r.community.error ? null : r.community.license ? "ok" : "issue"),
  },
  { id: "DOC003", label: "License declared", source: "OpenSSF Scorecard: License", other: (r) => sc(r, "License", (s) => s > 0) },
  {
    id: "DOC004",
    label: "Contribution guide",
    source: "GitHub community profile",
    other: (r) => (r.community.error ? null : r.community.contributing ? "ok" : "issue"),
  },
  {
    id: "SEC004",
    label: "Security policy",
    source: "OpenSSF Scorecard: Security-Policy",
    other: (r) => sc(r, "Security-Policy", (s) => s > 0),
  },
  {
    id: "SEC005+SEC006",
    label: "No dangerous workflow patterns",
    source: "OpenSSF Scorecard: Dangerous-Workflow",
    rp: (r) => {
      const a = rp(r, "SEC005");
      const b = rp(r, "SEC006");
      if (a === null && b === null) return null;
      return a === "issue" || b === "issue" ? "issue" : "ok";
    },
    other: (r) => sc(r, "Dangerous-Workflow"),
  },
  {
    id: "DEP004",
    label: "Dependency update tool",
    source: "OpenSSF Scorecard: Dependency-Update-Tool",
    other: (r) => sc(r, "Dependency-Update-Tool", (s) => s > 0),
  },
];

const ok = results.filter((r) => !r.repopilot.error);
const out = [];
out.push(`Data: ${ok.length}/${results.length} repositories analyzed by ${base}, collected ${collectedAt}.`);
const failed = results.filter((r) => r.repopilot.error);
if (failed.length) out.push(`Failed: ${failed.map((r) => `${r.repo} (${JSON.stringify(r.repopilot.error)})`).join(", ")}`);
out.push("");
out.push("| Rule | Check | Independent source | Compared | Agree | Disagree | Agreement |");
out.push("| --- | --- | --- | ---: | ---: | ---: | ---: |");
const disagreements = [];
for (const c of comparisons) {
  let agree = 0;
  let disagree = 0;
  for (const r of ok) {
    const a = c.rp ? c.rp(r) : rp(r, c.id);
    const b = c.other(r);
    if (a === null || b === null) continue;
    if (a === b) agree++;
    else {
      disagree++;
      disagreements.push(`- **${c.id}** ${r.repo}: RepoPilot=${a}, ${c.source}=${b}`);
    }
  }
  const n = agree + disagree;
  out.push(`| ${c.id} | ${c.label} | ${c.source} | ${n} | ${agree} | ${disagree} | ${n ? ((100 * agree) / n).toFixed(0) + "%" : "n/a"} |`);
}
out.push("");
out.push("### Disagreements");
out.push(...(disagreements.length ? disagreements : ["None."]));
out.push("");

// Findings inventory for manual review.
const byRule = new Map();
for (const r of ok) for (const f of r.repopilot.findings) byRule.set(f.ruleId, [...(byRule.get(f.ruleId) ?? []), { repo: r.repo, ...f }]);
out.push("### Findings by rule");
out.push("| Rule | Findings | Repos |");
out.push("| --- | ---: | --- |");
for (const [id, list] of [...byRule].sort()) out.push(`| ${id} | ${list.length} | ${list.map((f) => f.repo).join(", ")} |`);
out.push("");
out.push(`Total findings: ${[...byRule.values()].reduce((a, l) => a + l.length, 0)}`);
out.push("");
out.push("### Scores");
for (const r of ok)
  out.push(
    `- ${r.repo}: ${r.repopilot.score} (${r.repopilot.band}), ${r.repopilot.primaryLanguage}, ${r.repopilot.findings.length} findings`,
  );
console.log(out.join("\n"));
