"use client";

import type { Finding, PlanItem } from "@/lib/reports/schema";
import { Card } from "./ui";

const MAX_ITEMS = 5;

export function FixNext({
  plan,
  findings,
  overall,
  onSelect,
}: {
  plan: PlanItem[];
  findings: Finding[];
  overall: number | null;
  onSelect: (findingId: string) => void;
}) {
  if (overall === null) return null;
  const items = plan.slice(0, MAX_ITEMS);

  return (
    <Card className="p-5 sm:p-6" aria-labelledby="fix-next-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="fix-next-heading" className="text-lg font-semibold">
          Fix next
        </h2>
        <p className="text-sm text-fg-subtle">Ranked by score gain from fixing each check on its own</p>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 rounded-lg border border-line bg-ink-850 px-4 py-4 text-sm text-fg-muted">
          Nothing to fix: every applicable scored check passed.
        </p>
      ) : (
        <ol className="mt-4 space-y-2">
          {items.map((item, i) => {
            const finding = findings.find((f) => f.ruleId === item.ruleId);
            const content = (
              <>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line-strong text-xs tabular-nums text-fg-muted">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-fg">{finding?.title ?? item.title}</span>
                  <span className="block text-xs text-fg-subtle">
                    <span className="font-mono">{item.ruleId}</span> · {item.scoreCategory} · currently {item.status}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-semibold tabular-nums text-ok">+{item.gain.toFixed(1)}</span>
                  <span className="block text-xs tabular-nums text-fg-subtle">
                    {overall.toFixed(1)} → {item.projectedScore.toFixed(1)}
                  </span>
                </span>
              </>
            );
            const className = "flex w-full items-center gap-3 rounded-lg border border-line bg-ink-850/60 px-3 py-2.5 text-left";
            return (
              <li key={item.ruleId}>
                {finding ? (
                  <button
                    type="button"
                    onClick={() => onSelect(finding.id)}
                    className={`${className} transition-colors hover:border-line-strong hover:bg-ink-800/60`}
                    aria-label={`${finding.title}: plus ${item.gain.toFixed(1)} points. Show finding details.`}
                  >
                    {content}
                  </button>
                ) : (
                  <div className={className}>{content}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {plan.length > 1 && (
        <p className="mt-3 text-xs text-fg-subtle">
          Gains are calculated one fix at a time with the same formula as the score, so they don&apos;t simply add up.
          {plan.length > MAX_ITEMS && ` ${plan.length - MAX_ITEMS} more item(s) in the exported report.`}
        </p>
      )}
    </Card>
  );
}
