"use client";

import { useState } from "react";
import { copyText } from "@/lib/download";
import { Card } from "./ui";

/** Badge preview plus copyable README snippet and report link for this repository. */
export function ShareBadge({ owner, repo }: { owner: string; repo: string }) {
  // Rendered only after a client-side scan completes, so window is always available here.
  const origin = window.location.origin;
  const path = `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const badgeUrl = `${origin}/api/badge/${path}`;
  const reportUrl = `${origin}/analyze/${path}`;
  const markdown = `[![RepoPilot score](${badgeUrl})](${reportUrl})`;
  const [status, setStatus] = useState("");

  async function copy(text: string, what: string) {
    setStatus((await copyText(text)) ? `${what} copied.` : "Copy failed — select the text and copy it manually.");
  }

  const btn =
    "inline-flex h-8 items-center rounded-md border border-line-strong bg-ink-850 px-3 text-sm text-fg transition-colors hover:border-accent hover:text-white";

  return (
    <Card className="p-5 sm:p-6" aria-labelledby="share-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="share-heading" className="text-lg font-semibold">
          Share this report
        </h2>
        <p className="text-sm text-fg-subtle">The badge updates as your repository improves (cached for a few hours).</p>
      </div>
      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex shrink-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- dynamic SVG from our own API */}
          <img src={`/api/badge/${path}`} alt={`RepoPilot score badge for ${owner}/${repo}`} height={20} />
        </div>
        <code className="min-w-0 flex-1 break-all rounded-md border border-line bg-ink-950/80 px-3 py-2 font-mono text-xs text-fg-muted">
          {markdown}
        </code>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" className={btn} onClick={() => copy(markdown, "README badge Markdown")}>
            Copy badge Markdown
          </button>
          <button type="button" className={btn} onClick={() => copy(reportUrl, "Report link")}>
            Copy report link
          </button>
        </div>
      </div>
      <p role="status" className="mt-2 min-h-4 text-xs text-fg-subtle">
        {status}
      </p>
    </Card>
  );
}
