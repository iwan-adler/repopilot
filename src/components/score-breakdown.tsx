import Link from "next/link";
import type { Report } from "@/lib/reports/schema";
import { Card, scoreColor, scoreStroke } from "./ui";

export function ScoreBreakdown({ report }: { report: Report }) {
  return (
    <Card className="p-5 sm:p-6" aria-labelledby="breakdown-heading">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="breakdown-heading" className="text-lg font-semibold">
          Score breakdown
        </h2>
        <Link href="/methodology#scoring" className="text-sm text-accent hover:underline">
          How scoring works
        </Link>
      </div>
      <ul className="mt-4 space-y-4">
        {report.score.categories.map((c) => (
          <li key={c.id}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{c.label}</span>
              <span className="text-sm text-fg-subtle">
                weight {Math.round(c.weight * 100)}%
                {c.score !== null && Math.abs(c.effectiveWeight - c.weight) > 0.001 && (
                  <> → {Math.round(c.effectiveWeight * 100)}% effective</>
                )}
                <span className={`ml-3 text-base font-semibold tabular-nums ${scoreColor(c.score)}`}>
                  {c.score === null ? "n/a" : Math.round(c.score)}
                </span>
              </span>
            </div>
            <div
              className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-700"
              role="meter"
              aria-label={`${c.label} score`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={c.score ?? undefined}
              aria-valuetext={c.score === null ? "Not available" : `${c.score} of 100`}
            >
              <div className="h-full rounded-full" style={{ width: `${c.score ?? 0}%`, background: scoreStroke(c.score) }} />
            </div>
            <p className="mt-1 text-xs text-fg-subtle">{c.explanation}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
