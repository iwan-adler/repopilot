import type { CategoryScore, CheckResult, CheckStatus, PlanItem, Score, ScoreCategoryId } from "@/lib/reports/schema";

/**
 * Transparent scoring (documented in docs/SCORING.md).
 *
 *  1. Each check has a weight inside its score category and a status.
 *     Credit: pass = 1, warn = 0.5, fail = 0.
 *     not_applicable and unavailable checks are excluded from the denominator.
 *     Weight-0 checks are informational and never scored.
 *  2. Category score = 100 × Σ(weight × credit) / Σ(weight) over scored checks.
 *     A category with no scored checks is "unavailable" (score = null).
 *  3. Overall = Σ(categoryWeight × categoryScore) / Σ(categoryWeight) over available categories,
 *     i.e. weights of unavailable categories are redistributed proportionally.
 *
 * Each rule is evaluated exactly once and contributes to exactly one category, so related
 * findings are not double-counted.
 */

export type CategoryConfig = { id: ScoreCategoryId; label: string; weight: number };

/** Product decisions, not empirical benchmarks. Must sum to 1. */
export const DEFAULT_CATEGORY_WEIGHTS: CategoryConfig[] = [
  { id: "maintainability", label: "Maintainability", weight: 0.3 },
  { id: "testing", label: "Testing", weight: 0.25 },
  { id: "security", label: "Security signals", weight: 0.25 },
  { id: "hygiene", label: "Project hygiene", weight: 0.2 },
];

export const STATUS_CREDIT: Partial<Record<CheckStatus, number>> = {
  pass: 1,
  warn: 0.5,
  fail: 0,
};

export function isScored(check: Pick<CheckResult, "status" | "weight">): boolean {
  return check.weight > 0 && STATUS_CREDIT[check.status] !== undefined;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function bandFor(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

export const SCORING_METHOD =
  "Each check earns full (pass), half (warn) or no (fail) credit, weighted within its category. " +
  "Not-applicable and unavailable checks are excluded. Category scores are combined with configured weights; " +
  "weights of unavailable categories are redistributed. The score summarizes detected signals only — it is not a certification of security or production readiness.";

export function computeScore(checks: CheckResult[], config: CategoryConfig[] = DEFAULT_CATEGORY_WEIGHTS): Score {
  const totalConfigured = config.reduce((a, c) => a + c.weight, 0);
  if (totalConfigured <= 0) throw new Error("Category weights must sum to a positive number.");

  const partial = config.map((cat) => {
    const inCat = checks.filter((c) => c.scoreCategory === cat.id && c.weight > 0);
    const counts = {
      pass: inCat.filter((c) => c.status === "pass").length,
      warn: inCat.filter((c) => c.status === "warn").length,
      fail: inCat.filter((c) => c.status === "fail").length,
      notApplicable: inCat.filter((c) => c.status === "not_applicable").length,
      unavailable: inCat.filter((c) => c.status === "unavailable").length,
    };
    const scored = inCat.filter(isScored);
    const denom = scored.reduce((a, c) => a + c.weight, 0);
    const numer = scored.reduce((a, c) => a + c.weight * (STATUS_CREDIT[c.status] ?? 0), 0);
    const score = denom > 0 ? round1((100 * numer) / denom) : null;
    let explanation: string;
    if (score === null) {
      explanation =
        inCat.length === 0
          ? "No checks are defined for this category."
          : `No applicable checks could be evaluated (${counts.notApplicable} not applicable, ${counts.unavailable} unavailable). Excluded from the overall score.`;
    } else {
      explanation = `${counts.pass} passed, ${counts.warn} warned, ${counts.fail} failed across ${scored.length} scored checks (weighted ${round1(numer)} of ${denom}).`;
      if (counts.notApplicable + counts.unavailable > 0) {
        explanation += ` ${counts.notApplicable + counts.unavailable} check(s) excluded as not applicable or unavailable.`;
      }
    }
    return { cat, score, counts, explanation };
  });

  const availableWeight = partial.filter((p) => p.score !== null).reduce((a, p) => a + p.cat.weight, 0);

  const categories: CategoryScore[] = partial.map((p) => ({
    id: p.cat.id,
    label: p.cat.label,
    weight: p.cat.weight / totalConfigured,
    effectiveWeight: p.score !== null && availableWeight > 0 ? p.cat.weight / availableWeight : 0,
    score: p.score,
    counts: p.counts,
    explanation: p.explanation,
  }));

  let overall: number | null = null;
  if (availableWeight > 0) {
    overall = round1(categories.reduce((a, c) => a + (c.score ?? 0) * c.effectiveWeight, 0));
    overall = Math.min(100, Math.max(0, overall));
  }

  return {
    overall,
    band: overall === null ? null : bandFor(overall),
    categories,
    method: SCORING_METHOD,
  };
}

/**
 * Ranks failing/warning checks by how much fixing each one alone would raise the overall score.
 * Computed by re-running computeScore with that check set to "pass", so it uses exactly the
 * same arithmetic as the displayed score. Gains are not additive (category weights interact).
 */
export function computePlan(checks: CheckResult[], config: CategoryConfig[] = DEFAULT_CATEGORY_WEIGHTS): PlanItem[] {
  const base = computeScore(checks, config).overall;
  if (base === null) return [];
  const items: PlanItem[] = [];
  for (const check of checks) {
    if (check.weight <= 0 || (check.status !== "warn" && check.status !== "fail")) continue;
    const projected = computeScore(
      checks.map((c) => (c === check ? { ...c, status: "pass" as const } : c)),
      config,
    ).overall;
    if (projected === null) continue;
    const gain = round1(projected - base);
    if (gain <= 0) continue;
    items.push({
      ruleId: check.ruleId,
      title: check.title,
      status: check.status,
      scoreCategory: check.scoreCategory,
      projectedScore: projected,
      gain,
    });
  }
  return items.sort((a, b) => b.gain - a.gain || a.ruleId.localeCompare(b.ruleId));
}
