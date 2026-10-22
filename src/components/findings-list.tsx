"use client";

import { useMemo, useState } from "react";
import { fixKitFor } from "@/lib/fixes";
import type { FindingCategory, Report, Severity } from "@/lib/reports/schema";
import { FindingDetail } from "./finding-detail";
import { Card, CATEGORY_LABELS, SEVERITY_STYLES } from "./ui";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];

export function FindingsList({ report, focusId }: { report: Report; focusId?: string }) {
  const findings = report.findings;
  const kits = useMemo(() => new Map(findings.map((f) => [f.id, fixKitFor(f.ruleId, report)])), [findings, report]);
  const [severities, setSeverities] = useState<Set<Severity>>(new Set());
  const [category, setCategory] = useState<FindingCategory | "all">("all");

  const categories = useMemo(() => [...new Set(findings.map((f) => f.category))], [findings]);
  const filtered = findings.filter(
    (f) => (severities.size === 0 || severities.has(f.severity)) && (category === "all" || f.category === category),
  );

  function toggle(s: Severity) {
    setSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  return (
    <Card className="p-5 sm:p-6" aria-labelledby="findings-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="findings-heading" className="text-lg font-semibold">
          Findings <span className="text-fg-subtle">({findings.length})</span>
        </h2>
        <p className="text-sm text-fg-subtle">Sorted by severity. Expand a finding for evidence and next steps.</p>
      </div>

      {findings.length > 0 && (
        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div role="group" aria-label="Filter by severity" className="flex flex-wrap gap-1.5">
            {SEVERITIES.map((s) => {
              const n = findings.filter((f) => f.severity === s).length;
              const active = severities.has(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={active}
                  disabled={n === 0}
                  onClick={() => toggle(s)}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-40 ${
                    active
                      ? `${SEVERITY_STYLES[s].ring} ${SEVERITY_STYLES[s].text}`
                      : "border-line bg-ink-850 text-fg-muted hover:border-line-strong"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${SEVERITY_STYLES[s].dot}`} aria-hidden="true" />
                  {SEVERITY_STYLES[s].label}
                  <span className="tabular-nums text-fg-subtle">{n}</span>
                </button>
              );
            })}
          </div>
          <label className="flex items-center gap-2 text-sm text-fg-muted">
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as FindingCategory | "all")}
              className="rounded-md border border-line bg-ink-850 px-2 py-1 text-sm text-fg"
            >
              <option value="all">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="mt-4 space-y-2" aria-live="polite">
        {findings.length === 0 && (
          <p className="rounded-lg border border-line bg-ink-850 px-4 py-6 text-center text-fg-muted">
            No findings. Every applicable check passed. Review the checks table and limitations below for what was and wasn&apos;t covered.
          </p>
        )}
        {findings.length > 0 && filtered.length === 0 && (
          <p className="rounded-lg border border-line bg-ink-850 px-4 py-6 text-center text-fg-muted">No findings match these filters.</p>
        )}
        {filtered.map((f, i) => (
          <FindingDetail
            key={f.id}
            finding={f}
            kit={kits.get(f.id) ?? null}
            defaultOpen={focusId ? f.id === focusId : i === 0 && (f.severity === "critical" || f.severity === "high")}
          />
        ))}
      </div>
    </Card>
  );
}
