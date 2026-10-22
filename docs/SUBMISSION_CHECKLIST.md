# Submission checklist (deadline: 31 October 2026)

Ticked items were verified on 22 October 2026; the method is noted after each. Unticked items need the project owner.

## Repository

- [x] Public GitHub repository created and pushed (`gh repo view`: public, default branch `main`, homepage set to the live URL)
- [x] No secrets tracked; only `.env.example` among `.env*` files (`git ls-files`, pattern search of the tree and full history; the only history match is AWS's documented placeholder key `AKIAIOSFODNN7EXAMPLE` in a test)
- [x] GitHub Actions CI on `main` is green: lint, format check, typecheck, tests, build
- [x] Private vulnerability reporting enabled (via the GitHub API on 22 October)
- [x] README links work; LICENSE present
- [x] RepoPilot's own repository scanned with RepoPilot (100, band A)
- [x] `feedback` label exists, so scan-feedback issues are labelled

## Deployment

- [x] Vercel project imported from GitHub (Hobby plan); pushes to `main` deploy automatically
- [ ] `GITHUB_TOKEN` set in Vercel → Settings → Environment Variables for Production (only visible in the Vercel dashboard)
- [x] Production URL serves the landing page over HTTPS with HSTS
- [x] Real scans in production: spf13/cobra (Go), BurntSushi/ripgrep (Rust), pallets/flask (Python), each 1.2–1.6 s on engine 0.3.3
- [x] Error paths in production: non-GitHub URL → 400 with a message; nonexistent repository → 404 with a message
- [x] Markdown and JSON exports in production (generated files inspected in the browser without saving them)
- [x] Mobile layout at 375 px: no horizontal overflow on the landing, methodology and report pages (browser emulation)
- [ ] Mobile layout checked on a real phone
- [x] Response headers present: `X-Frame-Options: DENY`, `Content-Security-Policy`, `Strict-Transport-Security`
- [ ] Vercel function logs show only repo name, outcome and duration (only visible in the Vercel dashboard; the logging code is covered by a test)

## Materials

- [ ] Demo video recorded (2–5 min) from the live deployment, following docs/DEMO_SCRIPT.md
- [ ] Video uploaded as Unlisted and the link tested in a private window
- [ ] Submission form: project name, description, repo URL, live URL, video URL
- [x] Business model summary (docs/BUSINESS_MODEL.md)
- [x] Explanations ready: scoring (docs/SCORING.md), security (docs/SECURITY.md), accuracy (docs/VALIDATION.md), limitations (README)

## Honesty check

- [x] No claims of customers, revenue, certifications or benchmarks; accuracy figures come from the published study
- [x] Paid tiers described as proposed or planned everywhere (landing page, README, business model)
- [x] Test results quoted match the latest CI run (260 tests)
- [ ] Spot-check about 10 findings in docs/VALIDATION.md yourself, then change "not yet independently reviewed by a human" to say so
- [ ] Real-user feedback collected (the "Feedback" link opens a one-minute GitHub issue form)
