import type { Report } from "@/lib/reports/schema";
import { Card, StatusLabel } from "./ui";

export function ChecksTable({ report }: { report: Report }) {
  return (
    <Card className="p-5 sm:p-6" aria-labelledby="checks-heading">
      <h2 id="checks-heading" className="text-lg font-semibold">
        All checks <span className="text-fg-subtle">({report.checks.length})</span>
      </h2>
      <p className="mt-1 text-sm text-fg-subtle">
        Every rule that ran, including passes. N/A and unavailable checks are excluded from the score.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <caption className="sr-only">Results of every RepoPilot check</caption>
          <thead className="text-xs uppercase tracking-wide text-fg-subtle">
            <tr className="border-b border-line">
              <th scope="col" className="py-2 pr-3 font-medium">
                Rule
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Check
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Category
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Weight
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Result
              </th>
              <th scope="col" className="py-2 font-medium">
                Detail
              </th>
            </tr>
          </thead>
          <tbody>
            {report.checks.map((c) => (
              <tr key={c.ruleId} className="border-b border-line/60 align-top last:border-0">
                <td className="py-2 pr-3 font-mono text-xs text-fg-subtle">{c.ruleId}</td>
                <td className="py-2 pr-3">{c.title}</td>
                <td className="py-2 pr-3 capitalize text-fg-muted">{c.scoreCategory}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-fg-muted">{c.weight === 0 ? "info" : c.weight}</td>
                <td className="whitespace-nowrap py-2 pr-3">
                  <StatusLabel status={c.status} />
                </td>
                <td className="py-2 text-fg-muted">{c.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
