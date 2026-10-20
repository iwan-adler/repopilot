"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ApiError, StreamEvent } from "@/lib/api/analyze-handler";
import type { ProgressEvent } from "@/lib/analysis/analyze-repository";
import { parseGitHubRepoUrl } from "@/lib/github/parse-url";
import { ReportSchema, type Report } from "@/lib/reports/schema";
import { AnalysisProgress } from "./analysis-progress";
import { ChecksTable } from "./checks-table";
import { FindingsList } from "./findings-list";
import { FixNext } from "./fix-next";
import { HealthOverview } from "./health-overview";
import { LimitationsPanel } from "./limitations-panel";
import { ReportExport } from "./report-export";
import { RepositoryForm } from "./repository-form";
import { ScoreBreakdown } from "./score-breakdown";
import { StackSummary } from "./stack-summary";
import { Card } from "./ui";

type State =
  | { status: "loading"; key: string; progress: ProgressEvent[] }
  | { status: "done"; key: string; report: Report; cached: boolean }
  | { status: "error"; key: string; error: ApiError };

const NETWORK_ERROR: ApiError = {
  code: "upstream_error",
  message: "Could not reach RepoPilot's server. Check your connection and try again.",
};

async function runAnalysis(url: string, signal: AbortSignal, onEvent: (e: StreamEvent) => void): Promise<void> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify({ url }),
    signal,
  });
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("application/x-ndjson")) {
    // Validation, rate-limit and busy errors are returned as plain JSON before streaming starts.
    const body = (await res.json().catch(() => null)) as { error?: ApiError } | null;
    onEvent({ type: "error", status: res.status, error: body?.error ?? NETWORK_ERROR });
    return;
  }
  if (!res.body) throw new Error("No response body");
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as StreamEvent);
    }
  }
}

export function AnalysisView() {
  const params = useParams<{ owner: string; repo: string }>();
  const owner = decodeURIComponent(params.owner ?? "");
  const repo = decodeURIComponent(params.repo ?? "");
  const parsed = parseGitHubRepoUrl(`${owner}/${repo}`);
  const key = parsed.ok ? `${parsed.value.owner}/${parsed.value.repo}` : "";

  const [state, setState] = useState<State | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Routes stay mounted but hidden after navigation (React Activity), and effects re-run when the
  // route becomes visible again. This ref prevents silently re-scanning a finished analysis.
  const finished = useRef<string | null>(null);
  // Finding selected from the "Fix next" plan; the nonce remounts the list so filters reset and it opens.
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);

  useEffect(() => {
    if (focus) document.getElementById(`finding-${focus.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focus]);

  useEffect(() => {
    if (!key) return;
    const runKey = `${key}#${attempt}`;
    if (finished.current === runKey) return;
    const controller = new AbortController();
    setState({ status: "loading", key, progress: [] });
    runAnalysis(key, controller.signal, (event) => {
      if (controller.signal.aborted) return;
      if (event.type === "progress") {
        setState((s) => (s && s.status === "loading" ? { ...s, progress: [...s.progress, event.event] } : s));
      } else if (event.type === "result") {
        const valid = ReportSchema.safeParse(event.report);
        finished.current = runKey;
        setState(
          valid.success
            ? { status: "done", key, report: valid.data, cached: event.cached }
            : { status: "error", key, error: { code: "internal_error", message: "The server returned a report that failed validation." } },
        );
      } else {
        finished.current = runKey;
        setState({ status: "error", key, error: event.error });
      }
    }).catch(() => {
      if (controller.signal.aborted) return;
      finished.current = runKey;
      setState({ status: "error", key, error: NETWORK_ERROR });
    });
    return () => controller.abort();
  }, [key, attempt]);

  if (!parsed.ok) {
    return <ErrorPanel title="That isn't a valid repository address" error={{ code: "invalid_url", message: parsed.error }} />;
  }

  if (!state || state.key !== key || state.status === "loading") {
    return <AnalysisProgress repo={key} events={state?.status === "loading" && state.key === key ? state.progress : []} />;
  }

  if (state.status === "error") {
    return <ErrorPanel title={`Couldn't analyze ${key}`} error={state.error} onRetry={() => setAttempt((a) => a + 1)} />;
  }

  const report = state.report;
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="text-sm text-fg-subtle">
          <Link href="/" className="text-accent hover:underline">
            ← New analysis
          </Link>
          {state.cached && (
            <span className="ml-3">
              Showing a result cached at {new Date(report.generatedAt).toLocaleTimeString()} (results are cached for up to 10 minutes).
            </span>
          )}
        </div>
        <ReportExport report={report} />
      </div>
      <div className="space-y-5">
        <HealthOverview report={report} />
        <div className="grid gap-5 lg:grid-cols-2">
          <FixNext
            plan={report.plan}
            findings={report.findings}
            overall={report.score.overall}
            onSelect={(id) => setFocus((f) => ({ id, nonce: (f?.nonce ?? 0) + 1 }))}
          />
          <ScoreBreakdown report={report} />
        </div>
        <FindingsList key={focus?.nonce ?? 0} findings={report.findings} focusId={focus?.id} />
        <StackSummary report={report} />
        <ChecksTable report={report} />
        <LimitationsPanel report={report} />
      </div>
    </div>
  );
}

function ErrorPanel({ title, error, onRetry }: { title: string; error: ApiError; onRetry?: () => void }) {
  const retryable = ["github_rate_limited", "rate_limited", "busy", "timeout", "upstream_error", "internal_error"].includes(error.code);
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <Card className="p-6" as="div">
        <div role="alert">
          <p className="text-sm font-medium text-bad">Analysis failed</p>
          <h1 className="mt-1 text-xl font-semibold">{title}</h1>
          <p className="mt-2 text-fg-muted">{error.message}</p>
          {error.retryAfterSeconds ? (
            <p className="mt-1 text-sm text-fg-subtle">Suggested wait: about {Math.ceil(error.retryAfterSeconds / 60)} minute(s).</p>
          ) : null}
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          {retryable && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg bg-accent px-4 py-2 font-medium text-white hover:bg-accent-strong"
            >
              Try again
            </button>
          )}
          <Link href="/" className="rounded-lg border border-line-strong px-4 py-2 text-fg hover:border-accent">
            Analyze a different repository
          </Link>
        </div>
        <div className="mt-6 border-t border-line pt-5">
          <RepositoryForm compact />
        </div>
      </Card>
    </div>
  );
}
