import type { Report } from "@/lib/reports/schema";

/** 1200×630 Open Graph card rendered by next/og (Satori: flexbox-only layout). */
export const OG_SIZE = { width: 1200, height: 630 };

const BG = "#050a17";
const FG = "#e7edf8";
const MUTED = "#a3b1cc";
const ACCENT = "#3d8bff";

function scoreColor(score: number): string {
  if (score >= 75) return "#3ddc97";
  if (score >= 50) return "#f5c542";
  return "#ff5c7a";
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 64,
        background: `radial-gradient(ellipse at top, #0f1f45 0%, ${BG} 65%)`,
        color: FG,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: "#0f1b3a",
            border: "2px solid #2a3c66",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: ACCENT,
            fontSize: 30,
          }}
        >
          ▲
        </div>
        <div style={{ fontSize: 36, fontWeight: 700 }}>RepoPilot</div>
      </div>
      {children}
      <div style={{ display: "flex", fontSize: 24, color: MUTED }}>Deterministic checks · evidence · ready-to-commit fixes</div>
    </div>
  );
}

export function SiteOgCard() {
  return (
    <Frame>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.1 }}>Understand your repository&apos;s health in minutes.</div>
        <div style={{ fontSize: 32, color: MUTED }}>Know exactly what to fix next. Paste any public GitHub URL.</div>
      </div>
    </Frame>
  );
}

export function RepoOgCard({ fullName, report }: { fullName: string; report: Report | null }) {
  const score = report?.score.overall ?? null;
  const top = report?.plan[0];
  // Name the problem (finding title), not the check, e.g. "No automated tests detected".
  const topTitle = top ? (report?.findings.find((f) => f.ruleId === top.ruleId)?.title ?? top.title) : "";
  return (
    <Frame>
      <div style={{ display: "flex", alignItems: "center", gap: 56 }}>
        {score !== null ? (
          <div
            style={{
              width: 220,
              height: 220,
              borderRadius: 110,
              border: `14px solid ${scoreColor(score)}`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div style={{ fontSize: 84, fontWeight: 700, color: scoreColor(score) }}>{String(Math.round(score))}</div>
            <div style={{ fontSize: 24, color: MUTED }}>{`band ${report?.score.band ?? ""}`}</div>
          </div>
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>
          <div style={{ fontSize: 26, color: MUTED }}>Repository health report</div>
          <div style={{ fontSize: fullName.length > 30 ? 48 : 60, fontWeight: 700 }}>{fullName}</div>
          {report && top ? (
            <div style={{ fontSize: 28, color: FG, display: "flex" }}>{`Top fix: ${topTitle} · +${top.gain.toFixed(1)} points`}</div>
          ) : report ? (
            <div style={{ fontSize: 28, color: "#3ddc97" }}>Every applicable check passed</div>
          ) : (
            <div style={{ fontSize: 28, color: MUTED }}>Scan it free — no sign-up</div>
          )}
        </div>
      </div>
    </Frame>
  );
}
