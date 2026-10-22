import Link from "next/link";
import { RepositoryForm } from "@/components/repository-form";
import { Section } from "@/components/section";
import { CATEGORY_LABELS } from "@/components/ui";
import { DEFAULT_LIMITS } from "@/lib/analysis/analyze-repository";
import { RULES } from "@/lib/analysis/rules";
import { DEFAULT_CATEGORY_WEIGHTS } from "@/lib/analysis/scoring";
import { RULES_WITH_FIX_KITS } from "@/lib/fixes";

const REPO_URL = "https://github.com/iwan-adler/repopilot";

const CATEGORY_ORDER = [
  "testing",
  "security",
  "documentation",
  "developer-experience",
  "dependencies",
  "maintainability",
  "structure",
] as const;

const scoredRules = RULES.filter((r) => r.weight > 0);

/** Facts about every scan. All values come from the engine's configuration or the published study. */
const FACTS: { label: string; value: string; note?: string }[] = [
  { label: "Rules", value: `${RULES.length}`, note: `${scoredRules.length} scored, across ${CATEGORY_ORDER.length} categories` },
  { label: "GitHub API requests", value: "4", note: "per scan; file contents come from raw.githubusercontent.com" },
  {
    label: "Scan budget",
    value: `${DEFAULT_LIMITS.deadlineMs / 1000} s`,
    note: `≤ ${DEFAULT_LIMITS.maxKeyFiles + DEFAULT_LIMITS.maxSampleFiles} files, ≤ ${DEFAULT_LIMITS.maxTotalBytes / 1024 / 1024} MB of content`,
  },
  { label: "Code executed", value: "none", note: "no clone, no install, no build" },
  { label: "Fix-it kits", value: `${RULES_WITH_FIX_KITS.length}`, note: "rules with ready-to-commit fixes" },
  { label: "Precision, unseen repos", value: "81.8%", note: "measured on 15 hold-out repositories" },
];

const STEPS = [
  {
    title: "Paste a public GitHub URL",
    body: "No account, no install and no OAuth. The address is validated and only GitHub's official endpoints are contacted.",
  },
  {
    title: "Rules inspect the repository",
    body: "The file tree, manifests, CI configuration, README and a bounded sample of text files are read at one pinned commit.",
  },
  {
    title: "Fix what's worth the most",
    body: "Findings carry evidence and are ranked by score gain. Common gaps come with a fix-it kit written for your stack.",
  },
];

type Tier = { name: string; price: string; status: string; available: boolean; features: string[] };

const TIERS: Tier[] = [
  {
    name: "Free",
    price: "$0",
    status: "Available",
    available: true,
    features: [
      "Public repositories, fair-use limits",
      `All ${scoredRules.length} scored checks`,
      "Fix-next plan and fix-it kits",
      "Markdown and JSON export, README badge",
    ],
  },
  {
    name: "Pro",
    price: "$9 / month",
    status: "Planned",
    available: false,
    features: ["Scan history and trends", "Compare branches and commits", "Larger content budgets", "Branded PDF reports"],
  },
  {
    name: "Team",
    price: "$29 / month",
    status: "Planned",
    available: false,
    features: [
      "Shared workspace and reports",
      "Private repositories via a GitHub App",
      "Scheduled scans and alerts",
      "Custom rule weights",
    ],
  },
];

export default function Home() {
  const grouped = CATEGORY_ORDER.map((cat) => ({ cat, rules: scoredRules.filter((r) => r.category === cat) })).filter(
    (g) => g.rules.length > 0,
  );

  return (
    <>
      <section className="mx-auto grid max-w-6xl gap-12 px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1fr_22rem] lg:gap-16">
        <div>
          <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl sm:leading-[1.1]">
            Understand your repository&apos;s health in minutes.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-fg-muted">
            RepoPilot checks a public GitHub repository for testing, security hygiene, documentation and maintainability gaps, shows the
            evidence for each one, and tells you which fix is worth the most.
          </p>
          <div className="mt-8 max-w-2xl">
            <RepositoryForm />
          </div>
        </div>

        <aside aria-label="About every scan" className="lg:mt-2">
          <dl className="divide-y divide-line border-y border-line">
            {FACTS.map((f) => (
              <div key={f.label} className="grid grid-cols-[1fr_auto] gap-x-4 py-3">
                <dt className="text-sm text-fg-muted">{f.label}</dt>
                <dd className="text-right font-mono text-sm text-fg">{f.value}</dd>
                {f.note && <dd className="col-span-2 mt-0.5 text-xs text-fg-subtle">{f.note}</dd>}
              </div>
            ))}
          </dl>
        </aside>
      </section>

      <Section id="how" title="How it works">
        <ol className="grid border-y border-line md:grid-cols-3 md:divide-x md:divide-line">
          {STEPS.map((s, i) => (
            <li key={s.title} className="border-b border-line py-5 last:border-b-0 md:border-b-0 md:px-5 md:first:pl-0 md:last:pr-0">
              <p className="font-mono text-xs text-fg-subtle">Step {i + 1}</p>
              <h3 className="mt-1.5 font-medium">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        id="checks"
        title="What it checks"
        intro={
          <>
            <p>Every rule has a stable ID, a written rationale and its own tests. Weights decide how much each rule moves its category.</p>
            <p className="mt-3">
              <Link href="/methodology" className="text-accent hover:underline">
                Full methodology
              </Link>
            </p>
          </>
        }
      >
        <div className="gap-x-10 md:columns-2 [&>div]:mb-8 [&>div]:break-inside-avoid">
          {grouped.map(({ cat, rules }) => (
            <div key={cat}>
              <h3 className="border-b border-line pb-2 text-sm font-medium">{CATEGORY_LABELS[cat]}</h3>
              <table className="mt-1 w-full text-sm">
                <caption className="sr-only">{CATEGORY_LABELS[cat]} rules</caption>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id}>
                      <td className="w-16 py-1.5 align-top font-mono text-xs leading-5 text-fg-subtle">{r.id}</td>
                      <td className="py-1.5 text-fg-muted">{r.title}</td>
                      <td className="w-10 py-1.5 text-right align-top font-mono text-xs leading-5 text-fg-subtle" title="Weight">
                        ×{r.weight}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <div>
            <h3 className="border-b border-line pb-2 text-sm font-medium">Score weights</h3>
            <table className="mt-1 w-full text-sm">
              <caption className="sr-only">Category weights in the overall score</caption>
              <tbody>
                {DEFAULT_CATEGORY_WEIGHTS.map((c) => (
                  <tr key={c.id}>
                    <td className="py-1.5 text-fg-muted">{c.label}</td>
                    <td className="py-1.5 text-right font-mono text-xs text-fg-subtle">{Math.round(c.weight * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs leading-relaxed text-fg-subtle">
              Weights are product decisions, not benchmarks. Checks that don&apos;t apply are left out instead of counted against you.
            </p>
          </div>
        </div>
      </Section>

      <Section
        id="accuracy"
        title="Measured accuracy"
        intro={
          <p>
            Findings were checked against GitHub&apos;s community profile, OpenSSF Scorecard and the repositories themselves. The method and
            raw data are{" "}
            <a href={`${REPO_URL}/blob/main/docs/VALIDATION.md`} className="text-accent hover:underline">
              published
            </a>
            .
          </p>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <caption className="sr-only">Precision of RepoPilot findings by evaluation set</caption>
            <thead className="text-left text-xs text-fg-subtle">
              <tr className="border-b border-line">
                <th scope="col" className="py-2 pr-4 font-normal">
                  Evaluation
                </th>
                <th scope="col" className="py-2 pr-4 font-normal">
                  Repositories
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">
                  Precision
                </th>
                <th scope="col" className="py-2 text-right font-normal">
                  Agreement with GitHub and Scorecard
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <tr>
                <td className="py-2.5 pr-4 text-fg-muted">First measurement (engine 0.2)</td>
                <td className="py-2.5 pr-4 font-mono text-fg-muted">26</td>
                <td className="py-2.5 pr-4 text-right font-mono text-fg-muted">65.7%</td>
                <td className="py-2.5 text-right font-mono text-fg-muted">70 to 100%</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 text-fg-muted">After fixing what it found (engine 0.3)</td>
                <td className="py-2.5 pr-4 font-mono text-fg-muted">26</td>
                <td className="py-2.5 pr-4 text-right font-mono text-fg">91.3%</td>
                <td className="py-2.5 text-right font-mono text-fg">100%</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 text-fg">Unseen repositories (hold-out)</td>
                <td className="py-2.5 pr-4 font-mono text-fg">15</td>
                <td className="py-2.5 pr-4 text-right font-mono text-fg">81.8%</td>
                <td className="py-2.5 text-right font-mono text-fg">100%</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-fg-subtle">
          Precision is the share of findings that were correct, excluding findings that are true but arguably not a problem. The hold-out
          figure is the best estimate for a repository RepoPilot hasn&apos;t seen.
        </p>
      </Section>

      <Section
        id="pricing"
        title="Pricing"
        intro={
          <p>
            RepoPilot is free. The paid tiers are proposals being validated with users. They aren&apos;t for sale and no payment is
            collected.
          </p>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] table-fixed text-sm">
            <caption className="sr-only">Free tier and proposed paid tiers</caption>
            <thead>
              <tr className="border-b border-line text-left align-bottom">
                {TIERS.map((t) => (
                  <th key={t.name} scope="col" className="pb-3 pr-6 font-normal">
                    <span className="block text-base font-semibold text-fg">{t.name}</span>
                    <span className="mt-1 block font-mono text-sm text-fg-muted">{t.price}</span>
                    <span className={`mt-1 block text-xs ${t.available ? "text-ok" : "text-fg-subtle"}`}>{t.status}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="align-top">
                {TIERS.map((t) => (
                  <td key={t.name} className="pr-6 pt-3">
                    <ul className="space-y-1.5 text-fg-muted">
                      {t.features.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="privacy" title="Privacy and limits">
        <div className="grid gap-10 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium">What happens to your data</h3>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-fg-muted">
              <li>Only public repositories are analyzed. There is no sign-in, no cookies and no analytics.</li>
              <li>Files are read from GitHub, processed in memory and never written to a database.</li>
              <li>Reports stay in a short in-memory cache for up to 10 minutes to save GitHub API quota.</li>
              <li>Anything that looks like a credential is redacted inside the analyzer and never displayed, logged or exported.</li>
              <li>Server logs hold the repository name, the outcome and the duration. Nothing else.</li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-medium">What RepoPilot doesn&apos;t do</h3>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-fg-muted">
              <li>It never runs your code, installs dependencies or executes tests. Detected tests are not run.</li>
              <li>Credential detection is pattern-based. It isn&apos;t a security audit and can miss secrets or flag placeholders.</li>
              <li>No vulnerability databases are consulted, so it makes no claims about known CVEs.</li>
              <li>Very large repositories are analyzed from a bounded sample, and the report says so.</li>
              <li>A high score is not a certificate of quality, security or production readiness.</li>
            </ul>
          </div>
        </div>
      </Section>
    </>
  );
}
