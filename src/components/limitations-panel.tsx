import type { Report } from "@/lib/reports/schema";
import { formatBytes } from "@/lib/analysis/paths";
import { Card } from "./ui";

export function LimitationsPanel({ report }: { report: Report }) {
  const b = report.budget;
  return (
    <Card className="p-5 sm:p-6" aria-labelledby="limits-heading">
      <h2 id="limits-heading" className="text-lg font-semibold">
        Analysis limitations
      </h2>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-fg-muted marker:text-fg-subtle">
        {report.limitations.map((l) => (
          <li key={l.code}>{l.message}</li>
        ))}
        <li>Credential detection is pattern-based and can produce false positives and false negatives. Matches are always redacted.</li>
        <li>Git history, issues, pull requests and branches other than the default branch are not analyzed.</li>
      </ul>
      <p className="mt-4 text-xs text-fg-subtle">
        This scan: {b.apiRequests} GitHub API requests · {b.filesFetched} files inspected ({formatBytes(b.bytesFetched)}) · {b.filesSkipped}{" "}
        skipped · {(b.durationMs / 1000).toFixed(1)} s · engine {report.engineVersion}
      </p>
    </Card>
  );
}
