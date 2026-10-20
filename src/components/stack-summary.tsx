import type { Report } from "@/lib/reports/schema";
import { Card, Pill } from "./ui";

const LANG_COLORS = ["#3d8bff", "#3ddc97", "#f5c542", "#ff9150", "#b38bff", "#55b8ff", "#ff5c7a", "#9aa8c4"];

export function StackSummary({ report }: { report: Report }) {
  const { stack, structure } = report;
  const langs = stack.languages.slice(0, 8);
  return (
    <Card className="p-5 sm:p-6" aria-labelledby="stack-heading">
      <h2 id="stack-heading" className="text-lg font-semibold">
        Stack &amp; structure
      </h2>

      <div className="mt-4">
        <h3 className="text-sm font-medium text-fg-muted">
          Languages{" "}
          <span className="font-normal text-fg-subtle">
            (
            {stack.languageSource === "github-linguist"
              ? "GitHub linguist"
              : stack.languageSource === "file-extensions"
                ? "estimated from file extensions"
                : "none detected"}
            )
          </span>
        </h3>
        {langs.length > 0 ? (
          <>
            <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-ink-700" aria-hidden="true">
              {langs.map((l, i) => (
                <div key={l.name} style={{ width: `${l.percent}%`, background: LANG_COLORS[i % LANG_COLORS.length] }} />
              ))}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {langs.map((l, i) => (
                <li key={l.name} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: LANG_COLORS[i % LANG_COLORS.length] }} aria-hidden="true" />
                  {l.name} <span className="text-fg-subtle tabular-nums">{l.percent}%</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-1 text-sm text-fg-subtle">No programming languages detected.</p>
        )}
      </div>

      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <Detected label="Frameworks" items={stack.frameworks} />
        <Detected label="Test frameworks" items={stack.testFrameworks} />
        <Detected label="Package managers" items={stack.packageManagers} />
        <div>
          <dt className="text-sm font-medium text-fg-muted">Manifests</dt>
          <dd className="mt-1.5 flex flex-wrap gap-1.5">
            {stack.manifests.length === 0 && <span className="text-sm text-fg-subtle">None detected</span>}
            {stack.manifests.slice(0, 10).map((m) => (
              <Pill key={m.path} className="font-mono">
                {m.path}
              </Pill>
            ))}
            {stack.manifests.length > 10 && <span className="text-xs text-fg-subtle">+{stack.manifests.length - 10} more</span>}
          </dd>
        </div>
      </dl>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Files" value={structure.totalFiles} />
        <Stat label="Directories" value={structure.totalDirectories} />
        <Stat label="Source files" value={structure.sourceFiles} />
        <Stat label="Test files" value={structure.testFiles} hint="detected, not run" />
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-medium text-fg-muted">Conventions</h3>
        <ul className="mt-2 grid gap-1.5 text-sm sm:grid-cols-2">
          {structure.conventions.map((c) => (
            <li key={c.name} className="flex items-center gap-2">
              <span aria-hidden="true" className={c.present ? "text-ok" : "text-fg-subtle"}>
                {c.present ? "●" : "○"}
              </span>
              <span className={c.present ? "" : "text-fg-subtle"}>
                {c.name}
                {c.path && <span className="ml-1 font-mono text-xs text-fg-subtle">{c.path}</span>}
              </span>
              <span className="sr-only">{c.present ? "present" : "not found"}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-fg-subtle">Conventions are informational and are not scored.</p>
      </div>
    </Card>
  );
}

function Detected({ label, items }: { label: string; items: { name: string; evidence: string }[] }) {
  return (
    <div>
      <dt className="text-sm font-medium text-fg-muted">{label}</dt>
      <dd className="mt-1.5 flex flex-wrap gap-1.5">
        {items.length === 0 && <span className="text-sm text-fg-subtle">None detected</span>}
        {items.map((i) => (
          <span key={i.name} title={i.evidence}>
            <Pill>{i.name}</Pill>
          </span>
        ))}
      </dd>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-ink-850 px-3 py-2">
      <div className="text-lg font-semibold tabular-nums">{value.toLocaleString("en-US")}</div>
      <div className="text-xs text-fg-subtle">
        {label}
        {hint && <span className="block">{hint}</span>}
      </div>
    </div>
  );
}
