import Link from "next/link";
import { RepositoryForm } from "@/components/repository-form";
import { Card, CATEGORY_LABELS } from "@/components/ui";
import { RULES } from "@/lib/analysis/rules";
import { DEFAULT_CATEGORY_WEIGHTS } from "@/lib/analysis/scoring";

const CATEGORY_ORDER = [
  "testing",
  "security",
  "documentation",
  "developer-experience",
  "dependencies",
  "maintainability",
  "structure",
] as const;

const STEPS = [
  {
    title: "Paste a public GitHub URL",
    body: "No account, no install, no OAuth. RepoPilot validates the address and talks only to GitHub's official API.",
  },
  {
    title: "Deterministic checks run",
    body: `${RULES.length} documented rules inspect the file tree, manifests, CI configuration, README and a bounded sample of text files.`,
  },
  {
    title: "Fix what matters first",
    body: "Findings are ranked by severity, each with evidence, rationale and a concrete recommendation. Export as Markdown or JSON.",
  },
];

const TIERS = [
  {
    name: "Free",
    price: "$0",
    status: "Available now",
    available: true,
    features: [
      "Public-repository scans (fair-use rate limits apply)",
      `All ${RULES.filter((r) => r.weight > 0).length} scored checks and the transparent score`,
      "Evidence-backed findings with recommendations",
      "Markdown and JSON report export",
    ],
  },
  {
    name: "Pro",
    price: "$9/mo",
    status: "Planned — not yet available",
    available: false,
    features: ["Scan history and trend charts", "Compare branches and commits", "Deeper content analysis budgets", "Branded PDF reports"],
  },
  {
    name: "Team",
    price: "$29/mo",
    status: "Planned — not yet available",
    available: false,
    features: [
      "Shared team workspace and reports",
      "Private repositories via GitHub App",
      "Scheduled scans and alerts",
      "Custom rule weights",
    ],
  },
];

export default function Home() {
  const grouped = CATEGORY_ORDER.map((cat) => ({ cat, rules: RULES.filter((r) => r.category === cat && r.weight > 0) })).filter(
    (g) => g.rules.length > 0,
  );

  return (
    <>
      {/* Hero */}
      <section className="border-b border-line bg-[radial-gradient(ellipse_at_top,rgba(61,139,255,0.12),transparent_60%)]">
        <div className="mx-auto max-w-3xl px-4 pb-16 pt-16 text-center sm:px-6 sm:pt-24">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-ink-900 px-3 py-1 text-xs text-fg-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            Static analysis · no code execution · no sign-up
          </p>
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Understand your repository&apos;s health in minutes.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-lg text-fg-muted">
            RepoPilot runs deterministic checks across testing, security signals, documentation and maintainability — and tells you exactly
            what to fix next, with evidence.
          </p>
          <div className="mx-auto mt-8 max-w-2xl text-left">
            <RepositoryForm />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section aria-labelledby="how-heading" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 id="how-heading" className="text-2xl font-semibold tracking-tight">
          How it works
        </h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <Card as="div" className="h-full p-5">
                <span className="font-mono text-sm text-accent">0{i + 1}</span>
                <h3 className="mt-2 font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-fg-muted">{s.body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      {/* Checks catalog (generated from the actual rule registry) */}
      <section id="checks" aria-labelledby="checks-heading" className="scroll-mt-20 border-y border-line bg-ink-900/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="checks-heading" className="text-2xl font-semibold tracking-tight">
                What RepoPilot checks
              </h2>
              <p className="mt-1 text-fg-muted">Every check has a stable rule ID, a documented rationale and unit tests.</p>
            </div>
            <Link href="/methodology" className="text-sm text-accent hover:underline">
              Full methodology →
            </Link>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {grouped.map(({ cat, rules }) => (
              <Card key={cat} className="p-5" as="div">
                <h3 className="font-semibold">{CATEGORY_LABELS[cat]}</h3>
                <ul className="mt-3 space-y-1.5 text-sm">
                  {rules.map((r) => (
                    <li key={r.id} className="flex gap-2">
                      <span className="w-14 shrink-0 font-mono text-xs leading-5 text-fg-subtle">{r.id}</span>
                      <span className="text-fg-muted">{r.title}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
            <Card className="p-5" as="div">
              <h3 className="font-semibold">Transparent score</h3>
              <ul className="mt-3 space-y-1.5 text-sm text-fg-muted">
                {DEFAULT_CATEGORY_WEIGHTS.map((c) => (
                  <li key={c.id} className="flex justify-between">
                    <span>{c.label}</span>
                    <span className="tabular-nums text-fg-subtle">{Math.round(c.weight * 100)}%</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-fg-subtle">
                Weights are product decisions, not benchmarks. Inapplicable checks are excluded rather than penalized.
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" aria-labelledby="pricing-heading" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6">
        <h2 id="pricing-heading" className="text-2xl font-semibold tracking-tight">
          Pricing
        </h2>
        <p className="mt-1 max-w-2xl text-fg-muted">
          RepoPilot is free today. Paid tiers below are <strong className="text-fg">proposals under validation</strong> — they are not for
          sale and no payment is collected.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {TIERS.map((t) => (
            <Card key={t.name} as="article" className={`flex flex-col p-6 ${t.available ? "border-accent/60" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-lg font-semibold">{t.name}</h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${t.available ? "bg-accent-soft text-accent" : "border border-line text-fg-subtle"}`}
                >
                  {t.status}
                </span>
              </div>
              <p className="mt-3 text-3xl font-semibold">
                {t.price}
                {!t.available && <span className="ml-2 align-middle text-sm font-normal text-fg-subtle">proposed</span>}
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-fg-muted">
                {t.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span aria-hidden="true" className={t.available ? "text-ok" : "text-fg-subtle"}>
                      {t.available ? "✓" : "○"}
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              {t.available ? (
                <Link href="/" className="mt-6 rounded-lg bg-accent px-4 py-2 text-center font-medium text-white hover:bg-accent-strong">
                  Analyze a repository
                </Link>
              ) : (
                <p className="mt-6 rounded-lg border border-dashed border-line px-4 py-2 text-center text-sm text-fg-subtle">
                  Not available yet
                </p>
              )}
            </Card>
          ))}
        </div>
      </section>

      {/* Privacy & limitations */}
      <section id="privacy" aria-labelledby="privacy-heading" className="scroll-mt-20 border-t border-line bg-ink-900/40">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 md:grid-cols-2">
          <div>
            <h2 id="privacy-heading" className="text-2xl font-semibold tracking-tight">
              Privacy
            </h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-fg-muted marker:text-fg-subtle">
              <li>Only public repositories are analyzed. No sign-in, no cookies, no analytics.</li>
              <li>Repository files are fetched read-only from GitHub, processed in memory, and never stored in a database.</li>
              <li>Reports are kept in a short-lived in-memory cache (up to 10 minutes) to reduce GitHub API usage.</li>
              <li>
                Potential credentials are redacted before they leave the analyzer; full values are never displayed, logged or exported.
              </li>
              <li>Server logs record only the repository name, outcome and duration.</li>
            </ul>
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Limitations</h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-fg-muted marker:text-fg-subtle">
              <li>Static analysis only: RepoPilot never runs code, installs dependencies, or executes tests.</li>
              <li>Credential detection is heuristic. It is not a security audit and can miss secrets or flag placeholders.</li>
              <li>Vulnerability databases are not consulted; RepoPilot makes no claims about known CVEs.</li>
              <li>Content checks use a bounded sample of files; very large repositories are partially analyzed and say so.</li>
              <li>A high score is not a certification of quality, security, or production readiness.</li>
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}
