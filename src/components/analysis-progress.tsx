import type { ProgressEvent } from "@/lib/analysis/analyze-repository";
import { Card } from "./ui";

const STAGES: { id: ProgressEvent["stage"]; label: string }[] = [
  { id: "metadata", label: "Fetch repository metadata" },
  { id: "tree", label: "Read the file tree" },
  { id: "files", label: "Inspect manifests, CI, README and sampled files" },
  { id: "analysis", label: "Run checks and compute the score" },
];

/** Shows only progress events actually reported by the server. */
export function AnalysisProgress({ repo, events }: { repo: string; events: ProgressEvent[] }) {
  const reached = new Set(events.map((e) => e.stage));
  const currentIndex = Math.max(-1, ...STAGES.map((s, i) => (reached.has(s.id) ? i : -1)));
  const lastFiles = [...events].reverse().find((e) => e.stage === "files");

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <Card className="p-6" as="div">
        <p className="text-sm text-fg-subtle">Analyzing</p>
        <h1 className="mt-1 break-words font-mono text-xl font-semibold">{repo}</h1>
        <ol className="mt-6 space-y-3" aria-live="polite">
          {STAGES.map((s, i) => {
            const state = i < currentIndex ? "done" : i === currentIndex ? "active" : "pending";
            return (
              <li key={s.id} className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${
                    state === "done"
                      ? "border-ok/50 bg-ok/10 text-ok"
                      : state === "active"
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-line text-fg-subtle"
                  }`}
                >
                  {state === "done" ? "✓" : state === "active" ? <span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> : i + 1}
                </span>
                <span className={state === "pending" ? "text-fg-subtle" : "text-fg"}>
                  {s.label}
                  {s.id === "files" && lastFiles && lastFiles.stage === "files" && (
                    <span className="ml-2 text-sm tabular-nums text-fg-subtle">
                      {lastFiles.done}/{lastFiles.total}
                    </span>
                  )}
                  <span className="sr-only">{state === "done" ? " (done)" : state === "active" ? " (in progress)" : ""}</span>
                </span>
              </li>
            );
          })}
        </ol>
        <p className="mt-6 text-sm text-fg-subtle">
          Typically 3–15 seconds. RepoPilot reads repository data through GitHub&apos;s API; it never clones, installs, or runs the code.
        </p>
      </Card>
    </div>
  );
}
