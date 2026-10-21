"use client";

import { useState } from "react";
import { copyText, downloadText } from "@/lib/download";
import type { FixKit } from "@/lib/fixes/fix-kits";

const btn =
  "inline-flex h-7 items-center rounded-md border border-line-strong bg-ink-850 px-2.5 text-xs text-fg transition-colors hover:border-accent hover:text-white";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className={btn}
      aria-label={label}
      onClick={async () => {
        setState((await copyText(text)) ? "copied" : "failed");
        setTimeout(() => setState("idle"), 2000);
      }}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
    </button>
  );
}

export function FixKitPanel({ kit }: { kit: FixKit }) {
  const commands = kit.commands.join("\n");
  return (
    <div className="rounded-lg border border-accent/40 bg-accent-soft/40 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium text-fg">
          Fix-it kit <span className="font-normal text-fg-muted">· {kit.title}</span>
        </p>
        <p className="text-xs text-fg-subtle">Generated for this repository. Review before committing.</p>
      </div>

      <div className="mt-3 space-y-3">
        {kit.files.map((f) => {
          const fileName = f.path.split("/").pop() || "file.txt";
          return (
            <div key={`${f.path}-${f.kind}`} className="overflow-hidden rounded-md border border-line bg-ink-950/80">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-1.5">
                <span className="min-w-0 break-all font-mono text-xs text-accent">
                  {f.path}
                  <span className="ml-2 font-sans text-fg-subtle">{f.kind === "create" ? "new file" : "add to existing file"}</span>
                </span>
                <span className="flex gap-1.5">
                  <CopyButton text={f.content} label={`Copy ${f.path}`} />
                  {f.kind === "create" && (
                    <button
                      type="button"
                      className={btn}
                      aria-label={`Download ${f.path}`}
                      onClick={() => downloadText(f.content, fileName)}
                    >
                      Download
                    </button>
                  )}
                </span>
              </div>
              <pre className="max-h-72 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed text-fg-muted">
                <code>{f.content}</code>
              </pre>
              {f.kind === "create" && f.path === "pyproject.toml" && (
                <p className="border-t border-line px-3 py-1.5 text-xs text-fg-subtle">
                  Other kits may also add pyproject.toml sections — combine them into one file.
                </p>
              )}
            </div>
          );
        })}

        {kit.commands.length > 0 && (
          <div className="overflow-hidden rounded-md border border-line bg-ink-950/80">
            <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
              <span className="text-xs text-fg-subtle">Run in your repository</span>
              <CopyButton text={commands} label="Copy commands" />
            </div>
            <pre className="overflow-auto px-3 py-2 font-mono text-xs leading-relaxed text-fg-muted">
              <code>{commands}</code>
            </pre>
          </div>
        )}

        {kit.notes.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-xs text-fg-muted marker:text-fg-subtle">
            {kit.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
