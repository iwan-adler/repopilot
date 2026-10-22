import type { CheckStatus } from "@/lib/reports/schema";
import { findCommunityFile } from "../context";
import { rootFile, pluralize, findReadme, readmeSignals } from "./helpers";
import type { Rule } from "./types";

/** Documentation: README, license and contribution guide. */
export const DOCUMENTATION_RULES: Rule[] = [
  {
    id: "DOC001",
    title: "README present",
    category: "documentation",
    scoreCategory: "hygiene",
    weight: 3,
    kind: "observation",
    rationale: "The README is the first thing users and contributors read; without it the project is hard to evaluate or use.",
    evaluate(ctx) {
      const readme = findReadme(ctx);
      if (readme) return { status: "pass", summary: `README found at ${readme}.` };
      return {
        status: "fail",
        summary: "No README found.",
        findings: [
          {
            severity: "high",
            title: "No README found",
            description: "No README file was found at the repository root, in .github/, or in docs/.",
            evidence: [{ detail: "Searched for README, README.md, README.rst, README.txt (case-insensitive)." }],
            recommendation: "Add a README.md describing what the project does, how to install and run it, and how to contribute.",
            confidence: "high",
          },
        ],
      };
    },
  },
  {
    id: "DOC002",
    title: "README completeness signals",
    category: "documentation",
    scoreCategory: "hygiene",
    weight: 2,
    kind: "heuristic",
    rationale: "READMEs that explain installation and usage with examples reduce onboarding time and support requests.",
    evaluate(ctx) {
      const readme = findReadme(ctx);
      if (!readme) return { status: "not_applicable", summary: "No README (covered by DOC001)." };
      const text = ctx.contents.get(readme);
      if (text === undefined) return { status: "unavailable", summary: "README content could not be retrieved." };
      const signals = readmeSignals(text);
      const missing = signals.filter((s) => !s.present);
      const present = signals.length - missing.length;
      const summary = `${present}/${signals.length} completeness signals present.`;
      if (missing.length === 0) return { status: "pass", summary };
      const status: CheckStatus = present >= 4 ? "pass" : present >= 2 ? "warn" : "fail";
      return {
        status,
        summary,
        findings: [
          {
            severity: status === "fail" ? "medium" : status === "warn" ? "low" : "info",
            title: "README is missing common sections",
            description: `The README at ${readme} lacks ${pluralize(missing.length, "common completeness signal")}.`,
            evidence: missing.map((s) => ({ path: readme, detail: `Missing: ${s.label}` })),
            recommendation:
              "Add the missing sections. A good minimum is: a one-paragraph description, installation steps, a usage example in a code block, and a license note.",
            confidence: "medium",
          },
        ],
      };
    },
  },
  {
    id: "DOC003",
    title: "License declared",
    category: "documentation",
    scoreCategory: "hygiene",
    weight: 2,
    kind: "observation",
    rationale:
      "Without a license, others have no legal permission to use, modify, or distribute the code, which blocks adoption and contributions.",
    evaluate(ctx) {
      const file = rootFile(ctx, /^(licen[sc]e|copying|unlicense)(\.[a-z]+|-[a-z]+)?$/i);
      const spdx = ctx.repository.license;
      if (file) return { status: "pass", summary: `License file ${file.path}${spdx ? ` (${spdx})` : ""}.` };
      if (spdx && spdx !== "NOASSERTION") return { status: "pass", summary: `GitHub reports license ${spdx}.` };
      return {
        status: "fail",
        summary: "No license file found.",
        findings: [
          {
            severity: "medium",
            title: "No license file",
            description: "No LICENSE/COPYING file exists at the repository root and GitHub did not detect a license.",
            evidence: [{ detail: "GitHub license metadata: none." }],
            recommendation:
              "Choose a license (choosealicense.com) and add it as LICENSE at the repository root. If the code is intentionally proprietary, state that explicitly in the README.",
            confidence: "high",
          },
        ],
      };
    },
  },
  {
    id: "DOC004",
    title: "Contribution guide",
    category: "documentation",
    scoreCategory: "hygiene",
    weight: 1,
    kind: "observation",
    rationale: "A contribution guide tells potential contributors how to set up, test, and submit changes.",
    evaluate(ctx) {
      const path = findCommunityFile(ctx.files, "contributing");
      if (path) return { status: "pass", summary: `Contribution guide at ${path}.` };
      const inherited = ctx.orgCommunityFiles?.contributing;
      if (inherited) return { status: "pass", summary: `Inherited from organization defaults: ${inherited}.` };
      return {
        status: "warn",
        summary: "No contribution guide.",
        findings: [
          {
            severity: "low",
            title: "No contribution guide",
            description: "No CONTRIBUTING file was found in the root, .github/, or docs/.",
            evidence: [{ detail: "Searched CONTRIBUTING(.md|.rst|.txt) in root, .github/ and docs/." }],
            recommendation:
              "If you accept contributions, add CONTRIBUTING.md covering local setup, how to run tests, and the pull-request process. Solo or private-use projects can skip this. RepoPilot also checked the owner's .github repository for organization-wide defaults and found none.",
            confidence: "high",
          },
        ],
      };
    },
  },
];
