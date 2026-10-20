# Business model

> Everything below is a **hypothesis** to be validated. RepoPilot has no paying customers, no revenue and no payment integration today.

## Problem

Developers inherit, adopt, or ship repositories without a quick, objective view of their engineering health. Existing options are either:

- **Heavy** — enterprise code-quality and security platforms that need setup, CI integration, or a paid plan; or
- **Narrow** — single-purpose linters and scanners that each answer one question; or
- **Vague** — AI chat answers that can't show evidence and aren't reproducible.

Small teams, students and indie maintainers need a **60-second, no-setup check** that says what's missing and what to fix first.

## Value proposition

> "Understand your repository's health in minutes, and know exactly what to fix next."

- Paste a URL; no account, install or CI change.
- Deterministic, evidence-backed findings with concrete recommendations.
- Transparent scoring that can be traced to individual rules.
- A shareable report (Markdown/JSON) for READMEs, PRs, coursework or due diligence.

## Target customers

| Segment | Job to be done |
| --- | --- |
| Independent developers & indie hackers | "Is my project presentable before launch or before I ask for contributors?" |
| Student teams | "Does our project meet good-practice expectations before submission?" |
| Open-source maintainers | "What community and hygiene gaps should I close?" |
| Small engineering teams / early startups | "Which of our repos need attention? Is this dependency's repo healthy?" |

## Pricing (proposed, unvalidated)

| Tier | Proposed price | Contents | Status |
| --- | --- | --- | --- |
| Free | $0 | Public-repo scans, all checks, Markdown/JSON export | **Available** |
| Pro | $9/month | Scan history, trend charts, commit/branch comparison, larger content budgets, branded reports | Planned |
| Team | $29/month | Shared workspace, private repos via a GitHub App, scheduled scans and alerts, custom weights | Planned |

Revenue model: recurring subscriptions, with the free tier as the acquisition funnel. Pro and Team features all require persistence (history, workspaces), which is why they are paid: they create real infrastructure cost.

## Acquisition approach (planned)

1. **Shareable reports.** A "Scanned with RepoPilot" badge or Markdown report in READMEs and PRs.
2. **Developer communities.** Show HN, r/programming, dev.to and Indian student/hackathon communities, with transparent methodology posts rather than ads.
3. **Education.** Free use by student teams and bootcamps, where repository hygiene is graded.
4. **Content.** Publishing the open rule catalog and explaining each rule (SEO for "how to add SECURITY.md", "pin GitHub Actions to SHA", and similar).
5. **GitHub Marketplace** listing once a GitHub App exists (Team tier).

## Validation plan

- Instrument privacy-friendly, aggregate counts (scans per day, export clicks) only with clear disclosure, or use a waitlist form, before building paid features.
- Interview 10–20 target users about which planned feature they'd pay for.
- Treat the $9/$29 price points as starting hypotheses for those interviews.

## Costs (honest)

### Today (hackathon MVP): ₹0
| Item | Provider | Cost |
| --- | --- | --- |
| Hosting + functions | Vercel Hobby | Free |
| GitHub API | Fine-grained personal token, 5,000 req/h | Free |
| CI | GitHub Actions (public repo) | Free |
| AI inference | None used | — |

### Constraints to know
- **Vercel Hobby is restricted to non-commercial, personal use** (Vercel Fair Use Guidelines, checked 2026-10-20). Accepting payments, or arguably even advertising paid plans, requires Vercel Pro or another host. The MVP collects no payments and labels paid tiers as proposals, but **before launching any paid tier RepoPilot must move to a commercial plan** (Vercel Pro is billed per member; check vercel.com/pricing for the current price) or a host whose free tier permits commercial use.
- Hobby includes about 1M function invocations, 4 hours of Active CPU and 100 GB of Fast Data Transfer per month (Vercel docs, as of 2026-09). A scan is mostly network wait, which doesn't count as Active CPU; real per-scan CPU has not been measured in production yet.
- GitHub's API limit (5,000 requests/hour per token, 4 per scan, before caching) caps throughput at about 1,250 uncached scans/hour per token. Scaling beyond that needs a GitHub App (higher limits per installation).

### Paid tiers would add
- A database for history and workspaces (a free tier may suffice initially; to be verified when built).
- A shared rate-limit/cache store (e.g. Redis).
- Payment processing fees (a provider such as Stripe or Razorpay; fees are a percentage per transaction).
- Commercial hosting plan (see above).

## Risks

- Overlap with free tools (OpenSSF Scorecard, GitHub's community profile, linters). Differentiation: one fast, explained, cross-category report with no setup.
- Heuristic findings can be wrong; trust depends on transparency and low false-positive rates.
- Dependence on GitHub's API terms and rate limits.
