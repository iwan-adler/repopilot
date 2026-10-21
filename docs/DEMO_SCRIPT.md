# Demo video script (target: 3:30–4:00)

> Record against the live deployment (https://repopilot-rho.vercel.app). Every result shown must come from a real scan made during recording. Say whatever numbers appear on screen; don't edit numbers into the video.

**Prep (15 minutes before recording):**

- Browser full-screen (F11), zoom 110–125%, other tabs closed, notifications off.
- Tabs in order: the landing page, the [GitHub repo](https://github.com/iwan-adler/repopilot), and [`docs/VALIDATION.md`](https://github.com/iwan-adler/repopilot/blob/main/docs/VALIDATION.md) on GitHub.
- Don't scan `karpathy/nanoGPT` in the 15 minutes before recording, so the live progress steps play (results are cached for 10 minutes).
- Practice once with a different repo (e.g. `sindresorhus/ky`).

---

### 0:00–0:20 · Problem

**Show:** landing page.
**Say:** "When you inherit a repo, pick a dependency, or prepare to launch, it's hard to know quickly whether the project is in good shape: tests, CI, docs, security hygiene. Big platforms need setup, and AI chat answers can't show evidence. RepoPilot gives you an evidence-based health check in seconds, with no sign-up."

### 0:20–0:45 · Live scan

**Do:** paste `https://github.com/karpathy/nanoGPT`, press **Analyze repository**.
**Say:** "These steps are real server events: metadata, the file tree, a bounded sample of files, then 29 deterministic checks. RepoPilot never clones or runs the code. It reads through GitHub's API under strict time and size budgets."

### 0:45–1:15 · Score and "Fix next"

**Show:** the score ring, then the **Fix next** panel.
**Say:** "nanoGPT is a brilliant, intentionally minimal teaching project, but it has no tests and no CI. The score is transparent: checks that don't apply are excluded, not penalized. And 'Fix next' ranks every gap by exactly how many points fixing it adds. Adding tests is worth fifteen points, computed with the same formula as the score."

### 1:15–2:00 · Finding and fix-it kit (the key moment)

**Do:** click the top **Fix next** item. It opens the finding.
**Say:** "Every finding has a rule ID, what we found, why it matters, the evidence, and a fix. For common gaps, it's an actual fix: a fix-it kit written for this repo's stack."
**Do:** scroll through the pytest kit, click **Copy** on the test file. Then click **No continuous integration configured** in Fix next and show the generated `ci.yml`.
**Say:** "This CI workflow is generated for Python with least-privilege permissions. Our tests prove that applying these files makes the checks pass, and that the workflow passes RepoPilot's own security checks."

### 2:00–2:20 · Share

**Do:** scroll to **Share this report**.
**Say:** "Every report has a README badge and a link preview with the real score. Every embedded badge is a backlink, which is our free acquisition channel."

### 2:20–2:55 · Measured accuracy

**Show:** `docs/VALIDATION.md` on GitHub, the precision table.
**Say:** "A deterministic tool can still be wrong, so we measured it. We scanned 26 well-known repositories and compared RepoPilot with GitHub's own data and OpenSSF Scorecard. The first version was only 66% precise. A third of its findings were wrong, mostly because it couldn't see organization-wide policy files and custom test runners. We fixed the root causes, added a regression test for each, and re-measured: 91%, and 100% agreement with both independent sources. The study is reproducible from the repo."
_(If the hold-out evaluation is in the doc, add one sentence with its number.)_

### 2:55–3:20 · How it's built

**Show:** the GitHub repo (tests folder, green CI check).
**Say:** "Next.js and strict TypeScript, Zod-validated data, and 250 tests that run against a fake GitHub, so they never touch the network. Only two fixed GitHub addresses are ever contacted, potential secrets are redacted inside the scanner, and there's no paid AI anywhere. It runs at zero cost."

### 3:20–3:45 · Business and close

**Show:** pricing section on the landing page.
**Say:** "It's free today for public repos. Pro and Team are proposed tiers for history, comparisons and private repos, the features that need storage. They're hypotheses we're validating, and nothing is for sale yet. RepoPilot: understand your repository's health in minutes, and know exactly what to fix next."

---

**Tips:** speak a little slower than feels natural; pause about a second after each click; re-record a section instead of editing out stumbles. Upload to YouTube as **Unlisted** and test the link in a private window.
