import { describe, expect, it } from "vitest";
import { bandFor, computeScore, DEFAULT_CATEGORY_WEIGHTS } from "@/lib/analysis/scoring";
import type { CheckResult, CheckStatus, ScoreCategoryId } from "@/lib/reports/schema";

function check(scoreCategory: ScoreCategoryId, status: CheckStatus, weight = 1, id = "TST001"): CheckResult {
  return { ruleId: id, title: "t", category: "testing", scoreCategory, weight, status, summary: "", kind: "observation" };
}

describe("computeScore", () => {
  it("configured weights sum to 1", () => {
    expect(DEFAULT_CATEGORY_WEIGHTS.reduce((a, c) => a + c.weight, 0)).toBeCloseTo(1);
  });

  it("returns null overall for an empty report", () => {
    const s = computeScore([]);
    expect(s.overall).toBeNull();
    expect(s.band).toBeNull();
    expect(s.categories.every((c) => c.score === null && c.effectiveWeight === 0)).toBe(true);
  });

  it("scores 100 when everything passes and 0 when everything fails", () => {
    const cats: ScoreCategoryId[] = ["maintainability", "testing", "security", "hygiene"];
    expect(computeScore(cats.map((c) => check(c, "pass"))).overall).toBe(100);
    expect(computeScore(cats.map((c) => check(c, "fail"))).overall).toBe(0);
  });

  it("gives half credit for warnings and weights checks within a category", () => {
    const s = computeScore([check("testing", "pass", 3), check("testing", "warn", 1), check("testing", "fail", 2)]);
    // (3*1 + 1*0.5 + 2*0) / 6 = 58.33
    expect(s.categories.find((c) => c.id === "testing")?.score).toBe(58.3);
  });

  it("excludes not-applicable, unavailable and weight-0 checks from the denominator", () => {
    const s = computeScore([
      check("security", "pass", 2),
      check("security", "not_applicable", 5),
      check("security", "unavailable", 5),
      check("security", "fail", 0),
    ]);
    const sec = s.categories.find((c) => c.id === "security")!;
    expect(sec.score).toBe(100);
    expect(sec.counts).toEqual({ pass: 1, warn: 0, fail: 0, notApplicable: 1, unavailable: 1 });
  });

  it("redistributes weight from unavailable categories", () => {
    const s = computeScore([check("testing", "not_applicable"), check("security", "pass"), check("hygiene", "fail"), check("maintainability", "pass")]);
    const testing = s.categories.find((c) => c.id === "testing")!;
    expect(testing.score).toBeNull();
    expect(testing.effectiveWeight).toBe(0);
    expect(testing.explanation).toMatch(/Excluded/);
    const eff = s.categories.reduce((a, c) => a + c.effectiveWeight, 0);
    expect(eff).toBeCloseTo(1);
    // (0.3*100 + 0.25*100 + 0.2*0) / 0.75 = 73.3
    expect(s.overall).toBe(73.3);
    expect(s.band).toBe("C");
  });

  it("is traceable: overall equals the effective-weighted sum of category scores", () => {
    const s = computeScore([check("testing", "pass"), check("security", "warn"), check("hygiene", "fail"), check("maintainability", "pass", 2), check("maintainability", "fail", 1)]);
    const recomputed = s.categories.reduce((a, c) => a + (c.score ?? 0) * c.effectiveWeight, 0);
    expect(s.overall).toBeCloseTo(recomputed, 0);
  });

  it("supports custom weights and rejects non-positive totals", () => {
    const s = computeScore([check("testing", "pass"), check("security", "fail")], [
      { id: "testing", label: "T", weight: 1 },
      { id: "security", label: "S", weight: 3 },
    ]);
    expect(s.overall).toBe(25);
    expect(() => computeScore([], [{ id: "testing", label: "T", weight: 0 }])).toThrow();
  });
});

describe("bandFor", () => {
  it("uses inclusive lower bounds", () => {
    expect([100, 90, 89.9, 75, 74.9, 60, 59.9, 40, 39.9, 0].map(bandFor)).toEqual(["A", "A", "B", "B", "C", "C", "D", "D", "F", "F"]);
  });
});

describe("docs/SCORING.md worked example", () => {
  it("matches the documented numbers", () => {
    const testing = [check("testing", "pass", 3), check("testing", "pass", 2), check("testing", "fail", 1), check("testing", "warn", 2)];
    // Maintainability 80: pass w4 + fail w1
    const maint = [check("maintainability", "pass", 4), check("maintainability", "fail", 1)];
    const security = [check("security", "pass", 1)];
    // Hygiene 90: pass w9 + fail w1
    const hygiene = [check("hygiene", "pass", 9), check("hygiene", "fail", 1)];
    const s = computeScore([...testing, ...maint, ...security, ...hygiene]);
    expect(s.categories.map((c) => c.score)).toEqual([80, 75, 100, 90]);
    expect(s.overall).toBe(85.8);
    expect(s.band).toBe("B");
  });
});
