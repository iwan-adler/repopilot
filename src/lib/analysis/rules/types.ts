import type { CheckStatus, Confidence, Evidence, FindingCategory, FindingKind, ScoreCategoryId, Severity } from "@/lib/reports/schema";
import type { AnalysisContext } from "../context";

export type FindingDraft = {
  severity: Severity;
  title: string;
  description: string;
  evidence: Evidence[];
  recommendation: string;
  confidence: Confidence;
};

export type RuleOutcome = {
  status: CheckStatus;
  /** One-line, human-readable result shown in the checks table. */
  summary: string;
  findings?: FindingDraft[];
};

export type Rule = {
  id: string;
  title: string;
  category: FindingCategory;
  scoreCategory: ScoreCategoryId;
  /** Relative importance inside its score category. 0 = informational (never scored). */
  weight: number;
  kind: FindingKind;
  /** Why this check matters. Copied into every finding the rule produces. */
  rationale: string;
  evaluate: (ctx: AnalysisContext) => RuleOutcome;
};

export const MAX_EVIDENCE = 25;
