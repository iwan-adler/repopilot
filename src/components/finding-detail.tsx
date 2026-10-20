"use client";

import { useId, useState } from "react";
import type { Finding } from "@/lib/reports/schema";
import { CATEGORY_LABELS, SeverityBadge } from "./ui";

export function FindingDetail({ finding, defaultOpen = false }: { finding: Finding; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <article className="rounded-lg border border-line bg-ink-850/60">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-start gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-ink-800/60"
        >
          <span className="mt-0.5 shrink-0">
            <SeverityBadge severity={finding.severity} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-fg">{finding.title}</span>
            <span className="mt-0.5 block text-xs text-fg-subtle">
              <span className="font-mono">{finding.ruleId}</span> · {CATEGORY_LABELS[finding.category]} · {finding.kind === "heuristic" ? "Heuristic" : "Verified observation"} ·{" "}
              {finding.confidence} confidence
            </span>
          </span>
          <span aria-hidden="true" className={`mt-1 shrink-0 text-fg-subtle transition-transform ${open ? "rotate-90" : ""}`}>
            ›
          </span>
        </button>
      </h3>
      <div id={panelId} hidden={!open} className="border-t border-line px-4 pb-4 pt-3 text-sm">
        <dl className="space-y-3">
          <div>
            <dt className="font-medium text-fg-muted">What we found</dt>
            <dd className="mt-0.5 text-fg">{finding.description}</dd>
          </div>
          <div>
            <dt className="font-medium text-fg-muted">Why it matters</dt>
            <dd className="mt-0.5 text-fg">{finding.rationale}</dd>
          </div>
          {finding.evidence.length > 0 && (
            <div>
              <dt className="font-medium text-fg-muted">Evidence</dt>
              <dd className="mt-1">
                <ul className="space-y-1">
                  {finding.evidence.map((e, i) => (
                    <li key={i} className="rounded-md border border-line bg-ink-950/60 px-3 py-1.5">
                      {e.path && (
                        <span className="mr-2 break-all font-mono text-xs text-accent">
                          {e.path}
                          {e.line ? `:${e.line}` : ""}
                        </span>
                      )}
                      <span className="break-words text-fg-muted">{e.detail}</span>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
          <div>
            <dt className="font-medium text-fg-muted">Recommendation</dt>
            <dd className="mt-0.5 text-fg">{finding.recommendation}</dd>
          </div>
        </dl>
      </div>
    </article>
  );
}
