/**
 * The rule registry. Each rule has a stable ID, a rationale, a score category and weight,
 * and is a pure function of the analysis context. Order here is the order rules run and
 * appear in reports.
 */
import { STRUCTURE_RULES } from "./structure";
import { DOCUMENTATION_RULES } from "./documentation";
import { TESTING_RULES } from "./testing";
import { DEVELOPER_EXPERIENCE_RULES } from "./developer-experience";
import { DEPENDENCY_RULES } from "./dependencies";
import { SECURITY_RULES } from "./security";
import { MAINTAINABILITY_RULES } from "./maintainability";
import type { Rule } from "./types";

export const RULES: Rule[] = [
  ...STRUCTURE_RULES,
  ...DOCUMENTATION_RULES,
  ...TESTING_RULES,
  ...DEVELOPER_EXPERIENCE_RULES,
  ...DEPENDENCY_RULES,
  ...SECURITY_RULES,
  ...MAINTAINABILITY_RULES,
];

export { findReadme, readmeSignals } from "./helpers";
export type { FindingDraft, Rule, RuleOutcome } from "./types";
