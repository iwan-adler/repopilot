import { describe, expect, it } from "vitest";
import { reportFileName, reportToJson } from "@/lib/reports/export-json";
import { escapeMarkdown, reportToMarkdown } from "@/lib/reports/export-markdown";
import { ReportSchema } from "@/lib/reports/schema";
import { HEALTHY_PROJECT, repoInfo, report } from "./helpers";

describe("exports", () => {
  const r = report({ "src/a.py": "x", ".env": "A=1" });

  it("JSON export round-trips through the schema", () => {
    const parsed = ReportSchema.parse(JSON.parse(reportToJson(r)));
    expect(parsed).toEqual(r);
  });

  it("JSON export rejects an invalid report", () => {
    expect(() => reportToJson({ ...r, schemaVersion: "9" as "1.0" })).toThrow();
  });

  it("Markdown export contains score, findings, checks and limitations", () => {
    const md = reportToMarkdown(r);
    expect(md).toMatch(/^# RepoPilot report: acme\/widget/);
    expect(md).toContain("## Score breakdown");
    expect(md).toContain("SEC002");
    expect(md).toContain("## All checks");
    expect(md).toContain("## Limitations");
    expect(md).toContain("not a security audit");
    for (const check of r.checks) expect(md).toContain(`| ${check.ruleId} |`);
  });

  it("Markdown export escapes repository-controlled text", () => {
    const evil = report(HEALTHY_PROJECT, { repository: repoInfo({ description: "<img src=x onerror=alert(1)> | [link](javascript:x)" }) });
    const md = reportToMarkdown(evil);
    expect(md).not.toContain("<img");
    expect(md).not.toContain("[link](javascript");
    expect(escapeMarkdown("a|b\nc")).toBe("a\\|b c");
  });

  it("produces safe file names", () => {
    expect(reportFileName(r, "md")).toBe("repopilot-acme_widget-0123456.md");
  });
});
