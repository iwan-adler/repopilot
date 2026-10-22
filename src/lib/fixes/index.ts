/**
 * Fix-it kits: ready-to-commit starter files and commands for common findings, tailored to
 * the detected stack. Built only from the report; commands are displayed, never executed.
 */
import type { Report } from "@/lib/reports/schema";
import type { FixKit } from "./shared";
import { ciWorkflow, ciTestStep, dependabot } from "./ci";
import { securityPolicy, contributing, license, gitignore, untrackEnvFiles, untrackDependencyDirs } from "./community";
import { testStarter, npmTestScript, linter, formatter, npmScripts, lockfile, pythonManifest } from "./tooling";

type Builder = (report: Report) => FixKit | null;

const BUILDERS: Record<string, Builder> = {
  DX003: ciWorkflow,
  TST004: ciTestStep,
  DEP004: dependabot,
  SEC004: securityPolicy,
  DOC004: contributing,
  DOC003: license,
  STR001: gitignore,
  SEC002: untrackEnvFiles,
  MNT002: untrackDependencyDirs,
  TST001: (r) => testStarter(r, "TST001"),
  TST002: (r) => testStarter(r, "TST002"),
  TST003: npmTestScript,
  DX001: linter,
  DX002: formatter,
  DX004: npmScripts,
  DEP001: lockfile,
  STR002: pythonManifest,
};

export const RULES_WITH_FIX_KITS = Object.keys(BUILDERS);

/** Returns a fix-it kit for a rule if one applies to this report, else null. */
export function fixKitFor(ruleId: string, report: Report): FixKit | null {
  const builder = BUILDERS[ruleId];
  if (!builder) return null;
  const kit = builder(report);
  if (!kit) return null;
  return { ...kit, files: kit.files.filter((f) => f.path.length > 0) };
}

export { safePath, describeStack } from "./shared";
export type { FixFile, FixKit } from "./shared";
