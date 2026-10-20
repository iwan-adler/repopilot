# Submission checklist (deadline: 31 October 2026)

Tick items only after verifying them yourself.

## Repository

- [ ] Public GitHub repository created and pushed
- [ ] `git log` and `git grep` show no secrets; `.env*` files (except `.env.example`) are not tracked
- [ ] GitHub Actions **CI** run on `main` is green (lint, typecheck, test, build)
- [ ] Private vulnerability reporting enabled (Settings → Code security)
- [ ] README links work; LICENSE present
- [ ] (Optional) Scan RepoPilot's own repository with RepoPilot and check the result is sensible

## Deployment

- [ ] Vercel project imported from GitHub (Hobby plan)
- [ ] `GITHUB_TOKEN` set in Vercel → Settings → Environment Variables (fine-grained token, public repositories read-only)
- [ ] Production URL loads the landing page over HTTPS
- [ ] A real scan works in production (try 3 repos of different languages)
- [ ] Error paths in production: invalid URL, nonexistent repo
- [ ] Markdown and JSON downloads work in production
- [ ] Mobile layout checked on a real phone
- [ ] Response headers present (`curl -I https://<url>` shows `x-frame-options: DENY`)
- [ ] Vercel function logs show only repo name, outcome and duration

## Materials

- [ ] Demo video recorded (2–5 min) from the live deployment, following docs/DEMO_SCRIPT.md
- [ ] Video uploaded and link tested in a private/incognito window
- [ ] Submission form: project name, description, repo URL, live URL, video URL
- [ ] Business model summary (docs/BUSINESS_MODEL.md) ready
- [ ] Be ready to explain: scoring (docs/SCORING.md), security (docs/SECURITY.md), limitations

## Honesty check

- [ ] No claims of customers, revenue, certifications or benchmarks
- [ ] Paid tiers described as proposed/planned everywhere
- [ ] Claims about test results match the latest CI run
