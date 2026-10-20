import type { Metadata } from "next";
import { Card, CATEGORY_LABELS } from "@/components/ui";
import { DEFAULT_LIMITS } from "@/lib/analysis/analyze-repository";
import { DEFAULT_ANALYSIS_OPTIONS } from "@/lib/analysis/context";
import { formatBytes } from "@/lib/analysis/paths";
import { RULES } from "@/lib/analysis/rules";
import { DEFAULT_CATEGORY_WEIGHTS } from "@/lib/analysis/scoring";

export const metadata: Metadata = {
  title: "Methodology",
  description: "Every RepoPilot rule, how the health score is computed, and the limits of the analysis.",
};

export default function MethodologyPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Methodology</h1>
      <p className="mt-2 max-w-3xl text-fg-muted">
        RepoPilot is a deterministic, rule-based analyzer. The same commit always produces the same findings. No AI model generates findings
        or scores.
      </p>

      <section id="scoring" aria-labelledby="scoring-heading" className="mt-10 scroll-mt-20">
        <h2 id="scoring-heading" className="text-xl font-semibold">
          How the score is computed
        </h2>
        <Card as="div" className="mt-4 p-5 text-sm leading-relaxed text-fg-muted">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Each check returns <strong className="text-fg">pass</strong> (full credit), <strong className="text-fg">warn</strong> (half
              credit), <strong className="text-fg">fail</strong> (no credit), <strong className="text-fg">not applicable</strong> or{" "}
              <strong className="text-fg">unavailable</strong>. The last two are removed from the calculation instead of being penalized.
            </li>
            <li>
              Each check has a weight within one score category. Category score = 100 × Σ(weight × credit) ÷ Σ(weight) over the scored checks.
            </li>
            <li>
              The overall score is the weighted average of available category scores. If a category has no applicable checks (for example,
              Testing in a documentation-only repository), its weight is redistributed proportionally to the others.
            </li>
            <li>Each rule contributes to exactly one category and is evaluated once, so related findings are not double-counted.</li>
            <li>Bands: A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 40, F &lt; 40.</li>
          </ol>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[320px] text-left">
              <caption className="sr-only">Category weights</caption>
              <thead className="text-xs uppercase tracking-wide text-fg-subtle">
                <tr className="border-b border-line">
                  <th scope="col" className="py-2">Category</th>
                  <th scope="col" className="py-2 text-right">Weight</th>
                  <th scope="col" className="py-2 text-right">Rules</th>
                </tr>
              </thead>
              <tbody>
                {DEFAULT_CATEGORY_WEIGHTS.map((c) => (
                  <tr key={c.id} className="border-b border-line/60 last:border-0">
                    <td className="py-2 text-fg">{c.label}</td>
                    <td className="py-2 text-right tabular-nums">{Math.round(c.weight * 100)}%</td>
                    <td className="py-2 text-right tabular-nums">{RULES.filter((r) => r.scoreCategory === c.id && r.weight > 0).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4">
            The weights are product decisions, not empirical benchmarks. A high score means RepoPilot detected good signals; it does not
            certify security, quality or production readiness.
          </p>
        </Card>
      </section>

      <section aria-labelledby="rules-heading" className="mt-10">
        <h2 id="rules-heading" className="text-xl font-semibold">
          Rule catalog ({RULES.length})
        </h2>
        <p className="mt-1 text-sm text-fg-subtle">
          &ldquo;Observation&rdquo; rules verify facts directly from repository data. &ldquo;Heuristic&rdquo; rules infer from naming or text
          patterns and can be wrong.
        </p>
        <div className="mt-4 space-y-3">
          {RULES.map((r) => (
            <Card as="article" key={r.id} className="p-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-sm text-accent">{r.id}</span>
                <h3 className="font-medium">{r.title}</h3>
                <span className="text-xs text-fg-subtle">
                  {CATEGORY_LABELS[r.category]} · scored under {r.scoreCategory} · weight {r.weight === 0 ? "0 (informational)" : r.weight} ·{" "}
                  {r.kind}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-fg-muted">{r.rationale}</p>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="limits-heading" className="mt-10">
        <h2 id="limits-heading" className="text-xl font-semibold">
          Scan budgets
        </h2>
        <Card as="div" className="mt-4 p-5 text-sm text-fg-muted">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Up to {DEFAULT_LIMITS.maxTreeEntries.toLocaleString("en-US")} tree entries (GitHub may truncate very large trees itself).</li>
            <li>
              Up to {DEFAULT_LIMITS.maxKeyFiles} key files (manifests, README, CI) of at most {formatBytes(DEFAULT_LIMITS.maxKeyFileBytes)} each.
            </li>
            <li>
              Up to {DEFAULT_LIMITS.maxSampleFiles} sampled text files of at most {formatBytes(DEFAULT_LIMITS.maxSampleFileBytes)} each for
              credential patterns.
            </li>
            <li>At most {formatBytes(DEFAULT_LIMITS.maxTotalBytes)} of file content and {DEFAULT_LIMITS.deadlineMs / 1000} seconds per scan.</li>
            <li>
              Oversized source threshold: {formatBytes(DEFAULT_ANALYSIS_OPTIONS.oversizedFileBytes)}; large committed file threshold:{" "}
              {formatBytes(DEFAULT_ANALYSIS_OPTIONS.largeFileBytes)}.
            </li>
          </ul>
        </Card>
      </section>
    </div>
  );
}
