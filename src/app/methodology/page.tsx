import type { Metadata } from "next";
import { Section } from "@/components/section";
import { CATEGORY_LABELS } from "@/components/ui";
import { DEFAULT_LIMITS } from "@/lib/analysis/analyze-repository";
import { DEFAULT_ANALYSIS_OPTIONS } from "@/lib/analysis/context";
import { formatBytes } from "@/lib/analysis/paths";
import { RULES } from "@/lib/analysis/rules";
import { DEFAULT_CATEGORY_WEIGHTS } from "@/lib/analysis/scoring";
import { RULES_WITH_FIX_KITS } from "@/lib/fixes";

export const metadata: Metadata = {
  title: "Methodology",
  description: "Every RepoPilot rule, how the health score is computed, and the limits of the analysis.",
};

const CATEGORY_ORDER = [
  "structure",
  "documentation",
  "testing",
  "developer-experience",
  "dependencies",
  "security",
  "maintainability",
] as const;

export default function MethodologyPage() {
  const kits = new Set(RULES_WITH_FIX_KITS);
  return (
    <>
      <div className="mx-auto max-w-6xl px-4 pb-12 pt-14 sm:px-6 sm:pt-20">
        <h1 className="text-4xl font-semibold tracking-tight">Methodology</h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-fg-muted">
          RepoPilot is a rule-based analyzer. The same commit always produces the same findings, and every number in a report can be traced
          to the rules below. No language model is involved in producing findings or scores.
        </p>
      </div>

      <Section
        id="scoring"
        title="How the score works"
        intro={<p>The full algorithm, with a worked example, is in docs/SCORING.md in the repository.</p>}
      >
        <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed text-fg-muted marker:font-mono marker:text-fg-subtle">
          <li>
            Each check ends as <em className="not-italic text-fg">pass</em> (full credit), <em className="not-italic text-fg">warn</em>{" "}
            (half credit), <em className="not-italic text-fg">fail</em> (no credit), or{" "}
            <em className="not-italic text-fg">not applicable</em> / <em className="not-italic text-fg">unavailable</em>, which are left out
            of the calculation rather than counted against the repository.
          </li>
          <li>
            Each check has a weight within one category. Category score = 100 × Σ(weight × credit) ÷ Σ(weight) over the scored checks.
          </li>
          <li>
            The overall score is the weighted average of the categories that could be scored. If a category has nothing to score, such as
            Testing in a documentation-only repository, its weight is shared among the others.
          </li>
          <li>Each rule belongs to exactly one category and runs once, so one problem is never counted twice.</li>
          <li>
            Bands: A from 90, B from 75, C from 60, D from 40, F below 40. The &ldquo;Fix next&rdquo; plan re-runs this calculation with
            each failing check set to pass, so its gains use exactly the same arithmetic.
          </li>
        </ol>

        <table className="mt-8 w-full max-w-md text-sm">
          <caption className="sr-only">Category weights</caption>
          <thead className="text-left text-xs text-fg-subtle">
            <tr className="border-b border-line">
              <th scope="col" className="py-2 font-normal">
                Category
              </th>
              <th scope="col" className="py-2 text-right font-normal">
                Weight
              </th>
              <th scope="col" className="py-2 text-right font-normal">
                Scored rules
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {DEFAULT_CATEGORY_WEIGHTS.map((c) => (
              <tr key={c.id}>
                <td className="py-2 text-fg-muted">{c.label}</td>
                <td className="py-2 text-right font-mono text-fg-muted">{Math.round(c.weight * 100)}%</td>
                <td className="py-2 text-right font-mono text-fg-muted">
                  {RULES.filter((r) => r.scoreCategory === c.id && r.weight > 0).length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 max-w-xl text-xs leading-relaxed text-fg-subtle">
          The weights are product decisions, not empirical benchmarks. A high score means good signals were detected. It doesn&apos;t
          certify security, quality or production readiness.
        </p>
      </Section>

      <Section
        id="rules"
        title={`Rules (${RULES.length})`}
        intro={
          <>
            <p>
              <span className="text-fg">Observation</span> rules state facts read directly from the repository.{" "}
              <span className="text-fg">Heuristic</span> rules infer from names or text patterns and can be wrong.
            </p>
            <p className="mt-3">
              <span className="font-mono text-xs text-accent">kit</span> marks rules with a ready-to-commit fix.
            </p>
          </>
        }
      >
        <div className="space-y-10">
          {CATEGORY_ORDER.map((cat) => {
            const rules = RULES.filter((r) => r.category === cat);
            if (rules.length === 0) return null;
            return (
              <div key={cat}>
                <h3 className="border-b border-line pb-2 font-medium">{CATEGORY_LABELS[cat]}</h3>
                <dl className="divide-y divide-line">
                  {rules.map((r) => (
                    <div key={r.id} className="grid gap-x-6 gap-y-1 py-3 sm:grid-cols-[5rem_1fr_8rem]">
                      <dt className="font-mono text-xs leading-6 text-fg-subtle">{r.id}</dt>
                      <dd className="min-w-0">
                        <p className="text-sm font-medium leading-6 text-fg">
                          {r.title}
                          {kits.has(r.id) && <span className="ml-2 font-mono text-xs font-normal text-accent">kit</span>}
                        </p>
                        <p className="mt-0.5 text-sm leading-relaxed text-fg-muted">{r.rationale}</p>
                      </dd>
                      <dd className="font-mono text-xs leading-6 text-fg-subtle sm:text-right">
                        {r.weight === 0 ? "not scored" : `×${r.weight} ${r.scoreCategory}`}
                        <span className="block">{r.kind}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        id="budgets"
        title="Scan budgets"
        intro={<p>Limits that keep every scan fast, cheap and safe to run on untrusted repositories.</p>}
      >
        <dl className="max-w-2xl divide-y divide-line border-y border-line text-sm">
          {[
            ["Tree entries", `${DEFAULT_LIMITS.maxTreeEntries.toLocaleString("en-US")} (GitHub may truncate very large trees itself)`],
            [
              "Key files",
              `${DEFAULT_LIMITS.maxKeyFiles} manifests, README and CI files, ${formatBytes(DEFAULT_LIMITS.maxKeyFileBytes)} each`,
            ],
            [
              "Sampled files",
              `${DEFAULT_LIMITS.maxSampleFiles} text files for credential patterns, ${formatBytes(DEFAULT_LIMITS.maxSampleFileBytes)} each`,
            ],
            ["Content per scan", formatBytes(DEFAULT_LIMITS.maxTotalBytes)],
            ["Time per scan", `${DEFAULT_LIMITS.deadlineMs / 1000} s`],
            ["Oversized source file", formatBytes(DEFAULT_ANALYSIS_OPTIONS.oversizedFileBytes)],
            ["Large committed file", formatBytes(DEFAULT_ANALYSIS_OPTIONS.largeFileBytes)],
          ].map(([k, v]) => (
            <div key={k} className="grid grid-cols-[11rem_1fr] gap-4 py-2.5">
              <dt className="text-fg-muted">{k}</dt>
              <dd className="font-mono text-xs leading-5 text-fg">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </>
  );
}
