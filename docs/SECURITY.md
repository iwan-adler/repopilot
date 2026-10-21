# Security & privacy

This document describes how RepoPilot protects itself and its users. To report a vulnerability, see [`SECURITY.md`](../SECURITY.md) at the repository root.

## Threat model

Every repository URL and every repository file is **untrusted input**. An attacker may submit crafted URLs, or create a repository containing malicious paths, huge files, deceptive content, or text designed to manipulate tools.

## Controls

### Input handling

- Strict URL parser (`parse-url.ts`): only `github.com` / `www.github.com`, no credentials, no ports, no control characters, max 300 chars, validated owner/repo syntax, reserved GitHub routes rejected.
- API body: `application/json` only, 2 KB cap (read with a streaming limit), strict Zod schema (unknown keys rejected).

### Outbound requests (SSRF prevention)

- The server never fetches a user-supplied URL. Requests are built from validated owner/repo names to **two fixed origins**: `https://api.github.com` and `https://raw.githubusercontent.com`.
- Redirects are followed manually and only if they stay on those origins (max 3 hops).
- Repository paths from the tree are percent-encoded per segment; `.`/`..`/empty segments are rejected.
- Per-request timeout (10 s), whole-scan deadline (25 s), streaming byte caps (12 MB JSON, 256 KB / 100 KB per file, 3 MB per scan), file-count limits, fetch concurrency of 8.
- GitHub responses are validated with Zod; malformed responses produce a typed error.

### No code execution

RepoPilot never clones repositories, installs dependencies, runs scripts, builds projects or evaluates file contents. Workflow YAML is examined with line-based text heuristics only.

Fix-it kits are generated in the browser from the report. Repository-derived values (paths, names, branch) are restricted to a safe character set before being placed into templates or shell commands, and the commands are only displayed for the user to review and run themselves.

### Secrets

- **GitHub token**: optional `GITHUB_TOKEN` is read only on the server and only sent to `api.github.com` (tested). Use a fine-grained token with public-repository read-only access and no extra permissions.
- **Detected credentials**: redacted inside the scanner (`redact()` shows at most 4 characters and never more than a quarter of the value, plus its length). Raw matches never leave `secrets.ts`, so they can't reach the report, UI, exports, cache or logs. A test asserts the full secret is absent from the serialized report.
- Raw file contents are never included in reports.

### Logging

Server logs contain only the repository name, outcome code, duration and cache flag. No file contents, report bodies, IPs or tokens are logged (tested).

### Abuse controls

- Per-IP sliding window (default 10 scans / 10 min), concurrency gate (4 scans per instance), 10-minute report cache, `Retry-After` headers.
- **Limitation:** these are in-memory and **per serverless instance**. On Vercel, separate instances do not share state, so the limit isn't global, and IP identification relies on the platform-set `x-forwarded-for` header. They stop casual abuse and accidental loops; they're not a guarantee. A global limit would need a shared store such as a free-tier Redis, which is deliberately not added until there's evidence it's needed.
- GitHub's own rate limit is detected and surfaced to users with a retry time.

### Private repositories

Only public repositories are analyzed. If a token could see a private repository, RepoPilot still refuses it (`private_repository`).

### Response headers

`X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`, and a CSP with `frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`. A full script-src CSP would require nonces with Next.js and is a planned hardening step.

### Rendering untrusted content

React escapes all text by default; no `dangerouslySetInnerHTML` is used. The Markdown exporter HTML-escapes `<`, `>`, `&` and escapes Markdown control characters in repository-controlled text (tested).

## Privacy

- No accounts, cookies, analytics or tracking.
- Repository data is processed in memory and kept only in a short-lived cache (≤ 10 minutes, per instance). Nothing is written to a database.
- Exports are generated in the browser.

## Known limitations

- Credential detection is heuristic. It can miss secrets (e.g. in files outside the sample, in Git history, or in unknown formats) and flag placeholders.
- No vulnerability (CVE) database is consulted, so RepoPilot makes no vulnerability claims.
- RepoPilot is not a security audit.
