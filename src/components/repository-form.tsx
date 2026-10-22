"use client";

import { useRouter } from "next/navigation";
import { useId, useLayoutEffect, useState, type FormEvent } from "react";
import { parseGitHubRepoUrl } from "@/lib/github/parse-url";

/** Real public repositories offered as one-click starting points (results are always scanned live). */
const SUGGESTIONS = ["pallets/flask", "sindresorhus/ky", "expressjs/express", "BurntSushi/ripgrep"];

export function RepositoryForm({ initialValue = "", compact = false }: { initialValue?: string; compact?: boolean }) {
  const router = useRouter();
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Routes are kept alive (hidden) after navigation; reset the transient pending state when hidden.
  useLayoutEffect(() => () => setPending(false), []);

  function go(input: string) {
    const parsed = parseGitHubRepoUrl(input);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setPending(true);
    router.push(`/analyze/${encodeURIComponent(parsed.value.owner)}/${encodeURIComponent(parsed.value.repo)}`);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    go(value);
  }

  return (
    <div className="w-full">
      <form onSubmit={onSubmit} noValidate className="flex w-full flex-col gap-2 sm:flex-row">
        <label htmlFor={inputId} className="sr-only">
          Public GitHub repository URL
        </label>
        <input
          id={inputId}
          name="url"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={300}
          placeholder="https://github.com/owner/repository"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
            if (pending) setPending(false);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={`min-w-0 flex-1 rounded-md border bg-ink-900 px-4 font-mono text-[15px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-accent/40 ${
            compact ? "h-11" : "h-12"
          } ${error ? "border-bad" : "border-line-strong"}`}
        />
        <button
          type="submit"
          disabled={pending}
          className={`inline-flex items-center justify-center gap-2 rounded-md bg-accent px-5 font-medium text-white transition-colors hover:bg-accent-strong disabled:cursor-wait disabled:opacity-70 ${
            compact ? "h-11" : "h-12"
          }`}
        >
          {pending ? "Opening…" : "Analyze repository"}
        </button>
      </form>
      <p id={errorId} role="alert" className="mt-2 min-h-5 text-sm text-bad">
        {error}
      </p>
      {!compact && (
        <p className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-fg-subtle">
          <span>Try</span>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setValue(`https://github.com/${s}`);
                go(s);
              }}
              className="font-mono text-xs text-fg-muted underline decoration-line-strong underline-offset-4 transition-colors hover:text-fg hover:decoration-fg-muted"
            >
              {s}
            </button>
          ))}
        </p>
      )}
    </div>
  );
}
