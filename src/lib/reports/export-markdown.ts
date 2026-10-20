import type { CheckStatus, Report } from "./schema";

/** Escapes text from untrusted sources (repository names, paths, descriptions) for Markdown. */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\r?\n/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_{}[\]()#+!|~])/g, "\\$1");
}

/** Inline code span that can safely contain backticks. */
function code(text: string): string {
  const clean = text.replace(/\r?\n/g, " ");
  const longest = Math.max(0, ...(clean.match(/`+/g) ?? []).map((m) => m.length));
  const fence = "`".repeat(longest + 1);
  const pad = clean.startsWith("`") || clean.endsWith("`") ? " " : "";
  return `${fence}${pad}${clean}${pad}${fence}`;
}

const STATUS_LABEL: Record<CheckStatus, string> = {
  pass: "✅ Pass",
  warn: "⚠️ Warn",
  fail: "❌ Fail",
  not_applicable: "➖ N/A",
  unavailable: "❔ Unavailable",
};

export function reportToMarkdown(report: Report): string {
  const r = report.repository;
  const lines: string[] = [];
  const overall = report.score.overall === null ? "Unavailable" : `${report.score.overall} / 100 (band ${report.score.band})`;

  lines.push(`# RepoPilot report: ${escapeMarkdown(r.fullName)}`);
  lines.push("");
  lines.push(`- **Repository:** ${r.url}`);
  lines.push(`- **Commit:** ${code(r.commitSha)} on ${code(r.defaultBranch)}`);
  lines.push(`- **Generated:** ${report.generatedAt} (engine ${report.engineVersion}, schema ${report.schemaVersion})`);
  if (r.description) lines.push(`- **Description:** ${escapeMarkdown(r.description)}`);
  lines.push(`- **Health score:** ${overall}`);
  lines.push("");
  lines.push(
    "> The score summarizes deterministic signals detected by static analysis. It is not a security audit or a certification of production readiness.",
  );
  lines.push("");

  lines.push("## Score breakdown");
  lines.push("");
  lines.push("| Category | Weight | Score | Pass | Warn | Fail | Excluded |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const c of report.score.categories) {
    lines.push(
      `| ${c.label} | ${Math.round(c.weight * 100)}% | ${c.score === null ? "n/a" : c.score} | ${c.counts.pass} | ${c.counts.warn} | ${c.counts.fail} | ${c.counts.notApplicable + c.counts.unavailable} |`,
    );
  }
  lines.push("");
  lines.push(`_${report.score.method}_`);
  lines.push("");

  if (report.plan.length > 0) {
    lines.push("## Fix next");
    lines.push("");
    lines.push("Checks ranked by how much fixing each one alone would raise the overall score (gains are not additive).");
    lines.push("");
    lines.push("| # | Rule | Check | Status | Score gain | Score after |");
    lines.push("| ---: | --- | --- | --- | ---: | ---: |");
    report.plan.forEach((p, i) => {
      lines.push(`| ${i + 1} | ${p.ruleId} | ${escapeMarkdown(p.title)} | ${p.status} | +${p.gain} | ${p.projectedScore} |`);
    });
    lines.push("");
  }

  lines.push("## Stack");
  lines.push("");
  const s = report.stack;
  lines.push(`- **Languages:** ${s.languages.map((l) => `${escapeMarkdown(l.name)} ${l.percent}%`).join(", ") || "none detected"}`);
  lines.push(`- **Frameworks:** ${s.frameworks.map((f) => escapeMarkdown(f.name)).join(", ") || "none detected"}`);
  lines.push(`- **Test frameworks:** ${s.testFrameworks.map((f) => escapeMarkdown(f.name)).join(", ") || "none detected"}`);
  lines.push(`- **Package managers:** ${s.packageManagers.map((f) => escapeMarkdown(f.name)).join(", ") || "none detected"}`);
  lines.push(`- **Manifests:** ${s.manifests.map((m) => code(m.path)).join(", ") || "none"}`);
  lines.push(
    `- **Files:** ${report.structure.totalFiles} (${report.structure.sourceFiles} source, ${report.structure.testFiles} test) in ${report.structure.totalDirectories} directories`,
  );
  lines.push("");

  lines.push(`## Findings (${report.findings.length})`);
  lines.push("");
  if (report.findings.length === 0) lines.push("No findings.");
  for (const f of report.findings) {
    lines.push(`### [${f.severity.toUpperCase()}] ${escapeMarkdown(f.title)} (${f.ruleId})`);
    lines.push("");
    lines.push(`- **Category:** ${f.category} · **Confidence:** ${f.confidence} · **Type:** ${f.kind}`);
    lines.push("");
    lines.push(`**What we found:** ${escapeMarkdown(f.description)}`);
    lines.push("");
    lines.push(`**Why it matters:** ${escapeMarkdown(f.rationale)}`);
    lines.push("");
    if (f.evidence.length > 0) {
      lines.push("**Evidence:**");
      lines.push("");
      for (const e of f.evidence) {
        const loc = e.path ? `${code(e.path + (e.line ? `:${e.line}` : ""))} — ` : "";
        lines.push(`- ${loc}${escapeMarkdown(e.detail)}`);
      }
      lines.push("");
    }
    lines.push(`**Recommendation:** ${escapeMarkdown(f.recommendation)}`);
    lines.push("");
  }

  lines.push("## All checks");
  lines.push("");
  lines.push("| Rule | Check | Category | Weight | Result | Summary |");
  lines.push("| --- | --- | --- | ---: | --- | --- |");
  for (const c of report.checks) {
    lines.push(
      `| ${c.ruleId} | ${escapeMarkdown(c.title)} | ${c.scoreCategory} | ${c.weight} | ${STATUS_LABEL[c.status]} | ${escapeMarkdown(c.summary)} |`,
    );
  }
  lines.push("");

  lines.push("## Limitations");
  lines.push("");
  for (const l of report.limitations) lines.push(`- ${escapeMarkdown(l.message)}`);
  lines.push("");
  lines.push(
    `_Budget: ${report.budget.apiRequests} GitHub API requests, ${report.budget.filesFetched} files inspected, ${report.budget.filesSkipped} skipped, ${report.budget.durationMs} ms._`,
  );
  lines.push("");
  return lines.join("\n");
}
