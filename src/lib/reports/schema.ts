import { z } from "zod";

/**
 * The normalized report object shared by the analyzer, API, UI and exporters.
 * Every report returned by the API is validated against this schema.
 */

export const SCHEMA_VERSION = "1.0" as const;

export const SeveritySchema = z.enum(["critical", "high", "medium", "low", "info"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const FindingCategorySchema = z.enum([
  "structure",
  "testing",
  "documentation",
  "developer-experience",
  "dependencies",
  "security",
  "maintainability",
]);
export type FindingCategory = z.infer<typeof FindingCategorySchema>;

export const ScoreCategoryIdSchema = z.enum(["maintainability", "testing", "security", "hygiene"]);
export type ScoreCategoryId = z.infer<typeof ScoreCategoryIdSchema>;

/** "observation" = directly verified from repository data; "heuristic" = pattern-based inference. */
export const FindingKindSchema = z.enum(["observation", "heuristic"]);
export type FindingKind = z.infer<typeof FindingKindSchema>;

export const EvidenceSchema = z.object({
  path: z.string().max(1024).optional(),
  line: z.number().int().positive().optional(),
  detail: z.string().max(1000),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const FindingSchema = z.object({
  id: z.string(),
  ruleId: z.string().regex(/^[A-Z]{2,4}\d{3}$/),
  category: FindingCategorySchema,
  severity: SeveritySchema,
  title: z.string().max(200),
  /** What was detected. */
  description: z.string().max(2000),
  /** Why it matters. */
  rationale: z.string().max(2000),
  evidence: z.array(EvidenceSchema).max(50),
  /** How to address it. */
  recommendation: z.string().max(2000),
  confidence: ConfidenceSchema,
  kind: FindingKindSchema,
});
export type Finding = z.infer<typeof FindingSchema>;

export const CheckStatusSchema = z.enum(["pass", "warn", "fail", "not_applicable", "unavailable"]);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

export const CheckResultSchema = z.object({
  ruleId: z.string(),
  title: z.string(),
  category: FindingCategorySchema,
  scoreCategory: ScoreCategoryIdSchema,
  weight: z.number().min(0),
  status: CheckStatusSchema,
  summary: z.string().max(1000),
  kind: FindingKindSchema,
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const CategoryScoreSchema = z.object({
  id: ScoreCategoryIdSchema,
  label: z.string(),
  /** Configured weight (0–1). */
  weight: z.number().min(0).max(1),
  /** Weight after redistributing unavailable categories (0–1). */
  effectiveWeight: z.number().min(0).max(1),
  /** 0–100, or null when no applicable checks could be evaluated. */
  score: z.number().min(0).max(100).nullable(),
  counts: z.object({
    pass: z.number().int().min(0),
    warn: z.number().int().min(0),
    fail: z.number().int().min(0),
    notApplicable: z.number().int().min(0),
    unavailable: z.number().int().min(0),
  }),
  explanation: z.string(),
});
export type CategoryScore = z.infer<typeof CategoryScoreSchema>;

export const ScoreSchema = z.object({
  overall: z.number().min(0).max(100).nullable(),
  band: z.enum(["A", "B", "C", "D", "F"]).nullable(),
  categories: z.array(CategoryScoreSchema),
  method: z.string(),
});
export type Score = z.infer<typeof ScoreSchema>;

export const LanguageShareSchema = z.object({
  name: z.string(),
  bytes: z.number().min(0),
  percent: z.number().min(0).max(100),
});

export const DetectedItemSchema = z.object({
  name: z.string(),
  evidence: z.string(),
});
export type DetectedItem = z.infer<typeof DetectedItemSchema>;

export const ManifestSchema = z.object({
  path: z.string(),
  ecosystem: z.string(),
});

export const StackSchema = z.object({
  primaryLanguage: z.string().nullable(),
  languages: z.array(LanguageShareSchema),
  languageSource: z.enum(["github-linguist", "file-extensions", "none"]),
  frameworks: z.array(DetectedItemSchema),
  testFrameworks: z.array(DetectedItemSchema),
  manifests: z.array(ManifestSchema),
  packageManagers: z.array(DetectedItemSchema),
  ecosystems: z.array(z.string()),
});
export type Stack = z.infer<typeof StackSchema>;

export const StructureSchema = z.object({
  totalFiles: z.number().int().min(0),
  totalDirectories: z.number().int().min(0),
  sourceFiles: z.number().int().min(0),
  testFiles: z.number().int().min(0),
  totalBytes: z.number().min(0),
  treeTruncated: z.boolean(),
  topLevelEntries: z.array(z.object({ name: z.string(), type: z.enum(["file", "dir"]) })).max(200),
  extensions: z.array(z.object({ extension: z.string(), count: z.number().int() })).max(20),
  conventions: z.array(z.object({ name: z.string(), present: z.boolean(), path: z.string().nullable() })),
});
export type Structure = z.infer<typeof StructureSchema>;

export const RepositoryInfoSchema = z.object({
  owner: z.string(),
  name: z.string(),
  fullName: z.string(),
  url: z.url(),
  description: z.string().nullable(),
  defaultBranch: z.string(),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/),
  stars: z.number().int().min(0),
  forks: z.number().int().min(0),
  openIssues: z.number().int().min(0),
  archived: z.boolean(),
  fork: z.boolean(),
  license: z.string().nullable(),
  sizeKb: z.number().min(0),
  pushedAt: z.string().nullable(),
  topics: z.array(z.string()),
});
export type RepositoryInfo = z.infer<typeof RepositoryInfoSchema>;

export const LimitationSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type Limitation = z.infer<typeof LimitationSchema>;

export const BudgetSchema = z.object({
  apiRequests: z.number().int().min(0),
  filesFetched: z.number().int().min(0),
  filesSkipped: z.number().int().min(0),
  bytesFetched: z.number().int().min(0),
  durationMs: z.number().min(0),
});

export const ReportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  engineVersion: z.string(),
  id: z.string(),
  generatedAt: z.iso.datetime(),
  repository: RepositoryInfoSchema,
  stack: StackSchema,
  structure: StructureSchema,
  checks: z.array(CheckResultSchema),
  findings: z.array(FindingSchema),
  score: ScoreSchema,
  limitations: z.array(LimitationSchema),
  budget: BudgetSchema,
});
export type Report = z.infer<typeof ReportSchema>;

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};
