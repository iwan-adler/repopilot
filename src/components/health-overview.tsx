import type { Report } from "@/lib/reports/schema";
import { formatBytes } from "@/lib/analysis/paths";
import { Card, Pill, SEVERITY_STYLES, scoreColor, scoreStroke } from "./ui";

function ScoreRing({ score, band }: { score: number | null; band: string | null }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const pct = score === null ? 0 : score / 100;
  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#172650" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={scoreStroke(score)}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-4xl font-semibold tabular-nums ${scoreColor(score)}`}>{score === null ? "—" : Math.round(score)}</span>
        <span className="text-xs text-fg-subtle">{score === null ? "unavailable" : `of 100 · band ${band}`}</span>
      </div>
    </div>
  );
}

export function HealthOverview({ report }: { report: Report }) {
  const r = report.repository;
  const counts = (["critical", "high", "medium", "low", "info"] as const).map((s) => ({
    severity: s,
    n: report.findings.filter((f) => f.severity === s).length,
  }));
  return (
    <Card className="p-5 sm:p-6" aria-labelledby="overview-heading">
      <div className="flex flex-col gap-6 md:flex-row md:items-center">
        <ScoreRing score={report.score.overall} band={report.score.band} />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-fg-subtle">Repository health</p>
          <h1 id="overview-heading" className="mt-0.5 break-words text-2xl font-semibold tracking-tight">
            <a href={r.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent">
              {r.fullName}
            </a>
          </h1>
          {r.description && <p className="mt-1 text-fg-muted">{r.description}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill>
              <span className="font-mono">{r.defaultBranch}</span>
              <span className="mx-1 text-fg-subtle">@</span>
              <span className="font-mono">{r.commitSha.slice(0, 7)}</span>
            </Pill>
            {report.stack.primaryLanguage && <Pill>{report.stack.primaryLanguage}</Pill>}
            <Pill>★ {r.stars.toLocaleString("en-US")}</Pill>
            <Pill>{r.license ?? "No license detected"}</Pill>
            <Pill>
              {report.structure.totalFiles.toLocaleString("en-US")} files · {formatBytes(report.structure.totalBytes)}
            </Pill>
            {r.archived && <Pill className="border-sev-medium/40 text-sev-medium">Archived</Pill>}
            {r.fork && <Pill>Fork</Pill>}
          </div>
        </div>
        <dl className="grid shrink-0 grid-cols-5 divide-x divide-line border-y border-line md:w-56 md:grid-cols-1 md:divide-x-0 md:divide-y">
          {counts.map(({ severity, n }) => (
            <div key={severity} className="flex flex-col items-center py-2 md:flex-row md:justify-between md:py-1.5">
              <dt className={`flex items-center gap-1.5 text-xs ${n > 0 ? SEVERITY_STYLES[severity].text : "text-fg-subtle"}`}>
                <span
                  className={`h-1.5 w-1.5 rounded-full ${n > 0 ? SEVERITY_STYLES[severity].dot : "bg-line-strong"}`}
                  aria-hidden="true"
                />
                {SEVERITY_STYLES[severity].label}
              </dt>
              <dd className={`font-mono text-sm tabular-nums ${n > 0 ? "text-fg" : "text-fg-subtle"}`}>{n}</dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="mt-5 border-t border-line pt-4 text-xs text-fg-subtle">
        Score summarizes {report.checks.filter((c) => c.weight > 0).length} deterministic checks. It reflects detected signals only, and is
        not a security audit or a certification of production readiness. Generated {new Date(report.generatedAt).toUTCString()}.
      </p>
    </Card>
  );
}
