# Architecture

RepoPilot is a **modular monolith**: one Next.js 16 (App Router) application with clearly separated layers. There is no database, authentication, queue or background worker, because nothing yet requires them.

## Request flow

```
Browser                         Next.js server (Vercel Function)                 GitHub
───────                         ─────────────────────────────────                ──────
RepositoryForm ──validate──▶ /analyze/[owner]/[repo]
AnalysisView ──POST /api/analyze (Accept: application/x-ndjson)──▶
                                handleAnalyzeRequest
                                  ├─ content-type, 2 KB body cap, Zod schema
                                  ├─ parseGitHubRepoUrl (strict)
                                  ├─ per-IP sliding-window limit
                                  ├─ 10-min report cache
                                  ├─ concurrency gate (4 scans / instance)
                                  └─ analyzeRepository ──────────────────────▶ api.github.com
                                       1. GET /repos/{o}/{r}           (metadata)
                                       2. GET /branches/{default}      (commit SHA)   } parallel
                                          GET /languages               (linguist)     }
                                       3. GET /git/trees/{sha}?recursive=1
                                       4. selectFiles → bounded fetch ─────────▶ raw.githubusercontent.com
                                       5. detectStack → RULES → computeScore
                                       6. ReportSchema.parse
       ◀── NDJSON: progress… result ──
Dashboard renders the validated Report; exports are generated client-side.
```

## Layers

| Layer            | Path                                                                         | Responsibility                                                                                                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL parsing      | `src/lib/github/parse-url.ts`                                                | Accepts `https://github.com/o/r`, `github.com/o/r`, `git@github.com:o/r.git`, `o/r`. Rejects other hosts, credentials, ports, reserved routes, malformed names. Pure.                                                                     |
| GitHub client    | `src/lib/github/client.ts`                                                   | Only contacts two fixed origins. Manual redirect handling (same origins only), per-request timeout, streaming byte caps, Zod validation of responses, typed `GitHubError` codes, rate-limit detection. Token sent to the API origin only. |
| Orchestration    | `src/lib/analysis/analyze-repository.ts`                                     | Fetches data, selects files, enforces budgets (files, bytes, deadline, concurrency), records limitations, and calls the pure `analyzeContext`.                                                                                            |
| Detection        | `detect-stack.ts`, `manifests.ts`, `paths.ts`                                | Languages, frameworks, test frameworks, manifests, package managers, path classification. Pure.                                                                                                                                           |
| Rules            | `rules/` (one module per category), `secrets.ts`, `workflows.ts`             | 30 rules; each is a pure function `AnalysisContext → RuleOutcome`. A throwing rule becomes `unavailable` instead of breaking the report.                                                                                                  |
| Scoring          | `scoring.ts`                                                                 | Transparent weighted scoring and the "Fix next" score-gain plan ([SCORING.md](SCORING.md)). Pure.                                                                                                                                         |
| Report           | `src/lib/reports/`                                                           | Zod schema (single source of truth for the report shape), Markdown and JSON exporters.                                                                                                                                                    |
| Fix-it kits      | `src/lib/fixes/` (`ci.ts`, `community.ts`, `tooling.ts`)                     | Pure templates keyed by rule ID that turn a report into ready-to-commit files and commands for the detected stack. Repository-derived values are sanitized; commands are displayed, never executed.                                       |
| Badge & previews | `src/lib/badge/`, `src/lib/og/`, `src/app/api/badge/`, `opengraph-image.tsx` | SVG badge and Open Graph cards built from cached reports via `getCachedReport`; CDN-cacheable responses.                                                                                                                                  |
| API              | `src/lib/api/`, `src/app/api/analyze/route.ts`                               | Validation, abuse controls, cache, error mapping, JSON/NDJSON responses. The route file is a thin adapter so the handler can be tested directly.                                                                                          |
| UI               | `src/components/`, `src/app/`                                                | Server-rendered landing and methodology pages (static); a client analysis view that consumes the stream.                                                                                                                                  |

## Key decisions

- **Deterministic rules, no AI.** Findings must be reproducible and defensible. AI explanations could be layered on later, but never as a source of evidence.
- **Pure core, thin I/O shell.** All detection, rules and scoring operate on an in-memory `AnalysisContext`, so they're tested with fixtures and no network.
- **`raw.githubusercontent.com` for file contents.** Reading files there does not consume the REST API quota, so a scan costs 4 API requests instead of ~100. The URL is built from a validated owner/repo, an exact commit SHA and per-segment-encoded paths from the tree.
- **Pinned commit SHA.** All files are read at the same commit, which is recorded in the report.
- **Streaming progress.** The API emits real progress events as NDJSON; the UI shows only stages the server actually reported.
- **No database.** Reports live in a short in-memory cache. Shareable URLs (`/analyze/owner/repo`) re-run or hit the cache. Persistent history is a planned paid feature and would need a verified free-tier store first.
- **Cache Components (Next 16 default).** Landing and methodology pages are fully static. The analysis page is partially prerendered with a Suspense boundary around the client view. Because Next keeps routes alive with React `<Activity>`, the view guards against re-running a finished scan when it becomes visible again.

## Budgets (defaults)

| Budget                                                 | Value                           |
| ------------------------------------------------------ | ------------------------------- |
| Tree entries                                           | 100,000                         |
| Key files (manifests, README, CI, nested package.json) | 40 × ≤ 256 KB                   |
| Sampled text files for credential scanning             | 80 × ≤ 100 KB                   |
| Total content per scan                                 | 3 MB                            |
| Scan deadline                                          | 25 s (route `maxDuration` 60 s) |
| Per-request timeout                                    | 10 s                            |
| Fetch concurrency                                      | 8                               |
| Concurrent scans per instance                          | 4                               |

## Testing strategy

`tests/fake-github.ts` implements an in-memory GitHub (metadata, branches, languages, trees, raw files, overrides for errors). The suites cover each layer independently plus end-to-end runs of `analyzeRepository` and `handleAnalyzeRequest`.
