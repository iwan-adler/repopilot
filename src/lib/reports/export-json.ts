import { ReportSchema, type Report } from "./schema";

/** Serializes a report after re-validating it, so exports always match the published schema. */
export function reportToJson(report: Report): string {
  return JSON.stringify(ReportSchema.parse(report), null, 2);
}

export function reportFileName(report: Report, extension: "md" | "json"): string {
  const safe = report.repository.fullName.replace(/[^A-Za-z0-9._-]+/g, "_");
  return `repopilot-${safe}-${report.repository.commitSha.slice(0, 7)}.${extension}`;
}
