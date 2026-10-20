"use client";

import { useState } from "react";
import { reportFileName, reportToJson } from "@/lib/reports/export-json";
import { reportToMarkdown } from "@/lib/reports/export-markdown";
import type { Report } from "@/lib/reports/schema";

function download(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ReportExport({ report }: { report: Report }) {
  const [status, setStatus] = useState<string>("");

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(reportToMarkdown(report));
      setStatus("Markdown copied to clipboard.");
    } catch {
      setStatus("Copy failed — use the download button instead.");
    }
  }

  const btn =
    "inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-ink-850 px-3 text-sm text-fg transition-colors hover:border-accent hover:text-white";

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={btn}
          onClick={() => {
            download(reportToMarkdown(report), reportFileName(report, "md"), "text/markdown;charset=utf-8");
            setStatus("Markdown report downloaded.");
          }}
        >
          Download Markdown
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => {
            download(reportToJson(report), reportFileName(report, "json"), "application/json;charset=utf-8");
            setStatus("JSON report downloaded.");
          }}
        >
          Download JSON
        </button>
        <button type="button" className={btn} onClick={copyMarkdown}>
          Copy Markdown
        </button>
      </div>
      <p role="status" className="min-h-4 text-xs text-fg-subtle">
        {status}
      </p>
    </div>
  );
}
