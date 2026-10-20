# Demo video script (target: 3–4 minutes)

> Record against the live deployment. Every result shown must come from a real scan made during recording. Don't edit numbers into the video.

**Prep:** a browser at the deployed URL; a second tab with the GitHub repo; one repository you've scanned before and know has interesting findings (pick it while preparing, by scanning a few candidates); `GITHUB_TOKEN` configured so rate limits don't interrupt you.

---

### 0:00 – 0:25 · Problem
**Show:** landing page.
**Say:** "When you inherit a repo, adopt a dependency, or get ready to launch, it's hard to know quickly whether the project is in good shape — tests, docs, CI, security hygiene. Big platforms need setup; AI chat answers can't show evidence. RepoPilot gives you an evidence-based health check in under a minute, with no sign-up."

### 0:25 – 1:15 · Live scan
**Do:** paste a public repo URL and press **Analyze**.
**Say (while the progress list advances):** "These steps are real server events streamed from the API: metadata, file tree, a bounded sample of files, then 29 scored checks. RepoPilot never clones or runs the code — it reads through GitHub's official API, under strict file, byte and time budgets."

**Show:** health score, band, severity counts.
**Say:** "The score is a weighted average of four categories. Checks that don't apply are excluded, not penalized."

### 1:15 – 2:15 · Findings
**Do:** filter by severity; expand the top finding.
**Say:** "Each finding has a stable rule ID, what we found, why it matters, the evidence — file paths and line numbers — and a concrete fix. It's labelled as a verified observation or a heuristic, with a confidence level."
**Do:** if there's a credential-pattern finding, show that the value is redacted. **Say:** "Potential secrets are redacted inside the scanner, so the full value never reaches the UI, logs or exports."
**Do:** scroll to **All checks**. **Say:** "You can see what passed too, and the limitations of this specific scan."

### 2:15 – 2:45 · Export
**Do:** click **Download Markdown** and open the file briefly.
**Say:** "Reports export as Markdown for READMEs and pull requests, or as schema-validated JSON for tooling."

### 2:45 – 3:20 · How it's built
**Show:** the methodology page, then the GitHub repo (tests folder, CI badge or Actions run).
**Say:** "Next.js and TypeScript in strict mode, Zod-validated data, deterministic rules with unit tests against a fake GitHub, so the tests never touch the network. Security: only two fixed GitHub origins, no user-controlled fetches, timeouts and size caps everywhere, redaction by construction."

### 3:20 – 3:50 · Business
**Show:** the pricing section.
**Say:** "Free today for public repos. Pro and Team are proposed tiers for history, comparisons, private repos and team workspaces — the features that need persistence. They're hypotheses we're validating, and nothing is for sale yet. It runs at zero cost on free tiers, with no paid AI."

### 3:50 – 4:00 · Close
**Say:** "RepoPilot: understand your repository's health in minutes, and know exactly what to fix next."
