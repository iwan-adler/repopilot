import type { Confidence, Evidence, Severity } from "@/lib/reports/schema";
import { findCommunityFile } from "../context";
import { basename, extname, formatBytes, isNonAuthoredPath } from "../paths";
import { scanTextForSecrets, type SecretMatch } from "../secrets";
import { checksOutPullRequestHead, findScriptInjections, findUnpinnedActions, isWorkflowPath, usesPullRequestTarget } from "../workflows";
import { hasSourceCode, KEY_MATERIAL_RE, isLowRiskPath, pluralize } from "./helpers";
import { MAX_EVIDENCE, type FindingDraft, type Rule } from "./types";

/** Security signals: credential patterns, committed secrets and GitHub Actions risks. Heuristic, not an audit. */
export const SECURITY_RULES: Rule[] = [
  {
    id: "SEC001",
    title: "No credential-like strings in scanned files",
    category: "security",
    scoreCategory: "security",
    weight: 4,
    kind: "heuristic",
    rationale:
      "Credentials committed to a public repository can be harvested by automated scanners within minutes. Removing them from the latest commit is not enough; they remain in Git history.",
    evaluate(ctx) {
      if (ctx.contents.size === 0) return { status: "unavailable", summary: "No file contents were available to scan." };
      const matches: SecretMatch[] = [];
      for (const [path, text] of ctx.contents) {
        // Key and certificate files are assessed by SEC003 (which also tells public from private
        // material); scanning them here too would report the same file twice.
        if (KEY_MATERIAL_RE.test(path)) continue;
        matches.push(...scanTextForSecrets(path, text));
      }
      const scanned = `${pluralize(ctx.contents.size, "file")} scanned`;
      if (matches.length === 0) return { status: "pass", summary: `${scanned}; no credential patterns matched.` };

      const byPattern = new Map<string, SecretMatch[]>();
      for (const m of matches) byPattern.set(m.patternId, [...(byPattern.get(m.patternId) ?? []), m]);

      let strong = false;
      const findings: FindingDraft[] = [];
      for (const group of byPattern.values()) {
        const real = group.filter((m) => !isLowRiskPath(m.path));
        const allLowRisk = real.length === 0;
        const first = group[0];
        const confidence: Confidence = allLowRisk ? "low" : first.confidence;
        const severity: Severity = allLowRisk ? "low" : first.severity;
        if (!allLowRisk && first.confidence !== "low") strong = true;
        findings.push({
          severity,
          title: `Possible ${first.label.toLowerCase()} committed`,
          description:
            `${pluralize(group.length, "match", "matches")} for the "${first.label}" pattern.` +
            (allLowRisk ? " All matches are in test, fixture, example or docs paths and may be intentional placeholders." : "") +
            " Values are redacted; RepoPilot did not verify whether they are live credentials.",
          evidence: group.slice(0, MAX_EVIDENCE).map((m) => ({ path: m.path, line: m.line, detail: `Matched value: ${m.redacted}` })),
          recommendation:
            "If this is a real credential: revoke/rotate it immediately at the provider, remove it from the code, load it from an environment variable or secret manager, and consider purging Git history. If it is a placeholder or test value, make that obvious (e.g. 'EXAMPLE') to avoid false positives.",
          confidence,
        });
      }
      return {
        status: strong ? "fail" : "warn",
        summary: `${scanned}; ${pluralize(matches.length, "credential-like match", "credential-like matches")}.`,
        findings,
      };
    },
  },
  {
    id: "SEC002",
    title: "No committed .env files",
    category: "security",
    scoreCategory: "security",
    weight: 3,
    kind: "observation",
    rationale: ".env files usually hold API keys, database URLs and other secrets that should never be committed.",
    evaluate(ctx) {
      const envFiles = ctx.files.filter((f) => {
        const base = basename(f.path).toLowerCase();
        // Empty files cannot contain secrets.
        if (!/^\.env(\.[a-z0-9_-]+)*$/.test(base) || f.size === 0) return false;
        return !/\.(example|sample|template|tpl|dist|defaults?|schema|ci|test)$/.test(base) && !isNonAuthoredPath(f.path);
      });
      if (envFiles.length === 0) return { status: "pass", summary: "No .env files committed." };
      const allLowRisk = envFiles.every((f) => isLowRiskPath(f.path));
      return {
        status: allLowRisk ? "warn" : "fail",
        summary: `${pluralize(envFiles.length, ".env file")} committed.`,
        findings: [
          {
            severity: allLowRisk ? "low" : "high",
            title: "Environment file committed",
            description: `${pluralize(envFiles.length, "environment file")} that commonly contain secrets ${envFiles.length === 1 ? "is" : "are"} tracked in Git. RepoPilot did not inspect whether they contain real values.`,
            evidence: envFiles.slice(0, MAX_EVIDENCE).map((f) => ({ path: f.path, detail: `${formatBytes(f.size)} file tracked in Git.` })),
            recommendation:
              "Remove the file from Git (git rm --cached), add it to .gitignore, rotate any secrets it contained, and commit a .env.example with placeholder values instead.",
            confidence: allLowRisk ? "low" : "medium",
          },
        ],
      };
    },
  },
  {
    id: "SEC003",
    title: "No committed private key files",
    category: "security",
    scoreCategory: "security",
    weight: 2,
    kind: "heuristic",
    rationale: "Private keys and keystores grant access to servers, signing identities, or TLS endpoints.",
    evaluate(ctx) {
      const candidates = ctx.files.filter((f) => {
        if (isNonAuthoredPath(f.path)) return false;
        const base = basename(f.path).toLowerCase();
        return /^id_(rsa|dsa|ecdsa|ed25519)$/.test(base) || ["pem", "key", "p12", "pfx", "jks", "keystore"].includes(extname(f.path));
      });
      // When the content was inspected, public material (PGP public keys, X.509 certificates) is not a secret,
      // e.g. PGP keys published for verifying release signatures.
      const isPublicMaterial = (path: string) => {
        const text = ctx.contents.get(path);
        return (
          text !== undefined &&
          /-----BEGIN (PGP PUBLIC KEY BLOCK|CERTIFICATE|PUBLIC KEY|RSA PUBLIC KEY)-----/.test(text) &&
          !/PRIVATE KEY/.test(text)
        );
      };
      const publicFiles = candidates.filter((f) => isPublicMaterial(f.path));
      const keyFiles = candidates.filter((f) => !isPublicMaterial(f.path));
      if (keyFiles.length === 0) {
        return {
          status: "pass",
          summary: publicFiles.length
            ? `${pluralize(publicFiles.length, "public key or certificate file")} committed; no private-key-like files.`
            : "No private-key-like files committed.",
        };
      }
      const real = keyFiles.filter((f) => !isLowRiskPath(f.path));
      return {
        status: real.length > 0 ? "fail" : "warn",
        summary: `${pluralize(keyFiles.length, "key-like file")} committed.`,
        findings: [
          {
            severity: real.length > 0 ? "high" : "low",
            title: "Key or certificate files committed",
            description:
              `${pluralize(keyFiles.length, "file")} with key/keystore names or extensions ${keyFiles.length === 1 ? "is" : "are"} tracked. ` +
              "Some may be public certificates or test fixtures; RepoPilot identifies them by name only.",
            evidence: keyFiles.slice(0, MAX_EVIDENCE).map((f) => ({
              path: f.path,
              detail: isLowRiskPath(f.path) ? "In a test/fixture/example path." : "Key-like file name or extension.",
            })),
            recommendation:
              "Confirm these files contain no private key material. Remove real keys from the repository, rotate them, and load them from a secret store at runtime.",
            confidence: real.length > 0 ? "medium" : "low",
          },
        ],
      };
    },
  },
  {
    id: "SEC004",
    title: "Security policy published",
    category: "security",
    scoreCategory: "security",
    weight: 1,
    kind: "observation",
    rationale: "A SECURITY.md tells researchers how to report vulnerabilities privately instead of opening public issues.",
    evaluate(ctx) {
      if (!hasSourceCode(ctx)) return { status: "not_applicable", summary: "No source code detected." };
      const path = findCommunityFile(ctx.files, "security");
      if (path) return { status: "pass", summary: `Security policy at ${path}.` };
      const inherited = ctx.orgCommunityFiles?.security;
      if (inherited) return { status: "pass", summary: `Inherited from organization defaults: ${inherited}.` };
      return {
        status: "warn",
        summary: "No SECURITY.md.",
        findings: [
          {
            severity: "low",
            title: "No security policy",
            description: "No SECURITY.md was found in the root, .github/ or docs/.",
            evidence: [{ detail: "Searched SECURITY.md in root, .github/ and docs/." }],
            recommendation:
              "Add SECURITY.md describing supported versions and how to report vulnerabilities (GitHub private vulnerability reporting is free). RepoPilot also checked the owner's .github repository for organization-wide defaults and found none.",
            confidence: "high",
          },
        ],
      };
    },
  },
  {
    id: "SEC005",
    title: "Safe use of pull_request_target",
    category: "security",
    scoreCategory: "security",
    weight: 2,
    kind: "heuristic",
    rationale:
      "pull_request_target workflows run with repository secrets and write permissions; checking out untrusted PR code in them lets any contributor execute code with those privileges.",
    evaluate(ctx) {
      const wfs = ctx.files.filter((f) => isWorkflowPath(f.path));
      if (wfs.length === 0) return { status: "not_applicable", summary: "No GitHub Actions workflows." };
      const fetched = wfs.filter((f) => ctx.contents.has(f.path));
      if (fetched.length === 0) return { status: "unavailable", summary: "Workflow files could not be retrieved." };
      const risky: Evidence[] = [];
      const prt: Evidence[] = [];
      for (const f of fetched) {
        const text = ctx.contents.get(f.path)!;
        if (!usesPullRequestTarget(text)) continue;
        const line = checksOutPullRequestHead(text);
        if (line) risky.push({ path: f.path, line, detail: "pull_request_target workflow checks out the pull request head ref." });
        else prt.push({ path: f.path, detail: "Workflow is triggered by pull_request_target." });
      }
      if (risky.length === 0 && prt.length === 0)
        return { status: "pass", summary: `${pluralize(fetched.length, "workflow")} checked; no pull_request_target usage.` };
      if (risky.length > 0) {
        return {
          status: "fail",
          summary: "pull_request_target checks out untrusted code.",
          findings: [
            {
              severity: "high",
              title: "pull_request_target runs untrusted pull-request code",
              description: "A workflow triggered by pull_request_target explicitly checks out the pull request's head commit.",
              evidence: risky,
              recommendation:
                "Use the pull_request trigger for building/testing PR code. If pull_request_target is required, never check out or execute the PR head, or split the job using workflow_run with minimal permissions.",
              confidence: "medium",
            },
          ],
        };
      }
      return {
        // Common, safe uses (labelers, triage bots) never check out PR code. Matching OpenSSF
        // Scorecard and GitHub's guidance, only an explicit head checkout is scored as a problem.
        status: "pass",
        summary: "pull_request_target is used without checking out pull-request code.",
        findings: [
          {
            severity: "info",
            title: "Workflow uses pull_request_target",
            description:
              "pull_request_target is used, but no explicit checkout of the pull request's code was found. This is the usual safe pattern for labelers and triage bots.",
            evidence: prt,
            recommendation: "Confirm the workflow never runs code from the pull request and declares minimal `permissions:`.",
            confidence: "low",
          },
        ],
      };
    },
  },
  {
    id: "SEC006",
    title: "No script injection in workflows",
    category: "security",
    scoreCategory: "security",
    weight: 2,
    kind: "heuristic",
    rationale:
      "Interpolating attacker-controlled values (issue titles, PR bodies, branch names) directly into run: scripts allows shell command injection in CI.",
    evaluate(ctx) {
      const wfs = ctx.files.filter((f) => isWorkflowPath(f.path));
      if (wfs.length === 0) return { status: "not_applicable", summary: "No GitHub Actions workflows." };
      const fetched = wfs.filter((f) => ctx.contents.has(f.path));
      if (fetched.length === 0) return { status: "unavailable", summary: "Workflow files could not be retrieved." };
      const evidence: Evidence[] = [];
      for (const f of fetched) {
        for (const line of findScriptInjections(ctx.contents.get(f.path)!)) {
          evidence.push({ path: f.path, line, detail: "Untrusted github.event expression interpolated into a script." });
        }
      }
      if (evidence.length === 0)
        return { status: "pass", summary: `${pluralize(fetched.length, "workflow")} checked; no untrusted interpolation in scripts.` };
      return {
        status: "fail",
        summary: `${pluralize(evidence.length, "possible script injection")}.`,
        findings: [
          {
            severity: "high",
            title: "Possible script injection in GitHub Actions",
            description: "Attacker-controllable event fields are interpolated with ${{ }} inside run: or script: blocks.",
            evidence: evidence.slice(0, MAX_EVIDENCE),
            recommendation:
              'Pass the value through an environment variable (env: TITLE: ${{ github.event.issue.title }}) and reference it as "$TITLE" in the script instead of interpolating it directly.',
            confidence: "medium",
          },
        ],
      };
    },
  },
  {
    id: "SEC007",
    title: "Third-party actions pinned to commits",
    category: "security",
    scoreCategory: "security",
    weight: 1,
    kind: "observation",
    rationale:
      "Tags and branches of third-party actions can be moved to malicious code; pinning to a full commit SHA makes the referenced code immutable.",
    evaluate(ctx) {
      const wfs = ctx.files.filter((f) => isWorkflowPath(f.path));
      if (wfs.length === 0) return { status: "not_applicable", summary: "No GitHub Actions workflows." };
      const fetched = wfs.filter((f) => ctx.contents.has(f.path));
      if (fetched.length === 0) return { status: "unavailable", summary: "Workflow files could not be retrieved." };
      const evidence: Evidence[] = [];
      for (const f of fetched) {
        for (const u of findUnpinnedActions(ctx.contents.get(f.path)!)) {
          evidence.push({ path: f.path, line: u.line, detail: `uses: ${u.ref}` });
        }
      }
      if (evidence.length === 0)
        return { status: "pass", summary: "All third-party actions are pinned to commit SHAs (or none are used)." };
      return {
        status: "warn",
        summary: `${pluralize(evidence.length, "third-party action reference")} not pinned to a SHA.`,
        findings: [
          {
            severity: "low",
            title: "Third-party actions referenced by mutable tags",
            description: `${pluralize(evidence.length, "third-party action reference")} use a tag or branch instead of a full commit SHA.`,
            evidence: evidence.slice(0, MAX_EVIDENCE),
            recommendation:
              "Pin third-party actions to a full-length commit SHA (with the version in a comment) and let Dependabot update them.",
            confidence: "high",
          },
        ],
      };
    },
  },
];
