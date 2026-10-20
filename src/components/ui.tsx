import type { CheckStatus, Severity } from "@/lib/reports/schema";
import type { ReactNode } from "react";

export const SEVERITY_STYLES: Record<Severity, { label: string; text: string; dot: string; ring: string }> = {
  critical: { label: "Critical", text: "text-sev-critical", dot: "bg-sev-critical", ring: "border-sev-critical/40 bg-sev-critical/10" },
  high: { label: "High", text: "text-sev-high", dot: "bg-sev-high", ring: "border-sev-high/40 bg-sev-high/10" },
  medium: { label: "Medium", text: "text-sev-medium", dot: "bg-sev-medium", ring: "border-sev-medium/40 bg-sev-medium/10" },
  low: { label: "Low", text: "text-sev-low", dot: "bg-sev-low", ring: "border-sev-low/40 bg-sev-low/10" },
  info: { label: "Info", text: "text-sev-info", dot: "bg-sev-info", ring: "border-sev-info/40 bg-sev-info/10" },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const s = SEVERITY_STYLES[severity];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${s.ring} ${s.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {s.label}
    </span>
  );
}

export const STATUS_STYLES: Record<CheckStatus, { label: string; className: string; symbol: string }> = {
  pass: { label: "Pass", className: "text-ok", symbol: "✓" },
  warn: { label: "Warn", className: "text-warn", symbol: "!" },
  fail: { label: "Fail", className: "text-bad", symbol: "✕" },
  not_applicable: { label: "N/A", className: "text-fg-subtle", symbol: "–" },
  unavailable: { label: "Unavailable", className: "text-fg-subtle", symbol: "?" },
};

export function StatusLabel({ status }: { status: CheckStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.className}`}>
      <span
        aria-hidden="true"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] leading-none"
      >
        {s.symbol}
      </span>
      {s.label}
    </span>
  );
}

export function Card({
  children,
  className = "",
  as: Tag = "section",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
  "aria-labelledby"?: string;
}) {
  return (
    <Tag className={`rounded-xl border border-line bg-ink-900/70 ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

export function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-md border border-line bg-ink-850 px-2 py-0.5 text-xs text-fg-muted ${className}`}>
      {children}
    </span>
  );
}

export function scoreColor(score: number | null): string {
  if (score === null) return "text-fg-subtle";
  if (score >= 75) return "text-ok";
  if (score >= 50) return "text-warn";
  return "text-bad";
}

export function scoreStroke(score: number | null): string {
  if (score === null) return "#2a3c66";
  if (score >= 75) return "#3ddc97";
  if (score >= 50) return "#f5c542";
  return "#ff5c7a";
}

export const CATEGORY_LABELS: Record<string, string> = {
  structure: "Structure",
  testing: "Testing",
  documentation: "Documentation",
  "developer-experience": "Developer experience",
  dependencies: "Dependencies",
  security: "Security signals",
  maintainability: "Maintainability",
};
