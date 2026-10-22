/** Helpers shared by the rule modules. All are pure functions of the analysis context. */
import { findPath, type AnalysisContext, type RepoFile } from "../context";
import { parsePackageJson, type PackageJson } from "../manifests";
import { isNonAuthoredPath, isRootFile, isSourceFile } from "../paths";

export function hasSourceCode(ctx: AnalysisContext): boolean {
  return ctx.files.some((f) => isSourceFile(f.path));
}

export function hasEcosystem(ctx: AnalysisContext, prefix: string): boolean {
  return ctx.stack.ecosystems.some((e) => e.startsWith(prefix));
}

/**
 * Share of the codebase at which a language without its own manifest gets tool checks.
 * Below it, helper scripts (e.g. Python utilities in a C project) don't trigger linter or
 * formatter findings. See docs/VALIDATION.md for how this threshold was chosen.
 */
export const SIGNIFICANT_LANGUAGE_SHARE = 20;

export function usesLanguage(ctx: AnalysisContext, names: string[]): boolean {
  return ctx.stack.languages.some((l) => names.includes(l.name) && l.percent >= SIGNIFICANT_LANGUAGE_SHARE);
}

/**
 * Ecosystem declared by a manifest at the repository root. Nested manifests (e.g.
 * tools/x/requirements.txt in a C project) describe helpers, not the project itself.
 */
export function hasRootEcosystem(ctx: AnalysisContext, prefix: string): boolean {
  return ctx.stack.manifests.some((m) => !m.path.includes("/") && m.ecosystem.startsWith(prefix));
}

/** Tool checks (linter/formatter) apply to the project's main ecosystems only. */
export function isJsProject(ctx: AnalysisContext): boolean {
  return (hasRootEcosystem(ctx, "JavaScript") && !jsIsSecondary(ctx)) || usesLanguage(ctx, ["JavaScript", "TypeScript"]);
}

export function isPythonProject(ctx: AnalysisContext): boolean {
  return hasRootEcosystem(ctx, "Python") || usesLanguage(ctx, ["Python"]);
}

/** Files whose purpose is to hold key/certificate material (assessed by SEC003, not SEC001). */
export const KEY_MATERIAL_RE = /(\.(pem|key|crt|cer|asc|p12|pfx|jks|keystore)$)|(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i;

/** Formatters / linters invoked from package.json scripts (start of a command or after && ; |). */
export const FORMATTER_CMD_RE =
  /(^|[;&|]\s*|npx\s+|pnpm\s+(exec\s+)?|bunx\s+)(prettier|oxfmt|dprint\s+fmt|biome\s+(format|check)|xo|standard)\b/;
export const LINTER_CMD_RE = /(^|[;&|]\s*|npx\s+|pnpm\s+(exec\s+)?|bunx\s+)(eslint|oxlint|biome\s+(lint|check)|xo|standard)\b/;

export function scriptsUse(pkg: PackageJson, re: RegExp): boolean {
  return Object.values(pkg.scripts ?? {}).some((cmd) => re.test(cmd.trim()));
}

export const NON_JS_ROOT_MANIFESTS = [
  "composer.json",
  "pyproject.toml",
  "requirements.txt",
  "gemfile",
  "go.mod",
  "cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "mix.exs",
];
export const JS_LANGUAGES = ["JavaScript", "TypeScript", "Vue", "Svelte", "Astro"];

/**
 * True when package.json only serves a non-JS project (e.g. Laravel's or Rails' frontend assets):
 * another ecosystem's manifest is at the root and the primary language isn't JS/TS.
 */
export function jsIsSecondary(ctx: AnalysisContext): boolean {
  const otherManifest = NON_JS_ROOT_MANIFESTS.some((m) => ctx.pathIndex.has(m));
  const primary = ctx.stack.primaryLanguage;
  return otherManifest && primary !== null && !JS_LANGUAGES.includes(primary);
}

export type RootPackage =
  { state: "absent" } | { state: "unfetched" } | { state: "invalid"; error: string } | { state: "ok"; pkg: PackageJson };

export function rootPackage(ctx: AnalysisContext): RootPackage {
  if (!ctx.pathIndex.has("package.json")) return { state: "absent" };
  const text = ctx.contents.get("package.json");
  if (text === undefined) return { state: "unfetched" };
  const parsed = parsePackageJson(text);
  return parsed.ok ? { state: "ok", pkg: parsed.data } : { state: "invalid", error: parsed.error };
}

export function textOf(ctx: AnalysisContext, path: string | null): string | null {
  if (!path) return null;
  return ctx.contents.get(path) ?? null;
}

export function rootFile(ctx: AnalysisContext, pattern: RegExp): RepoFile | undefined {
  return ctx.files.find((f) => isRootFile(f.path) && pattern.test(f.path));
}

export function anyFile(ctx: AnalysisContext, pattern: RegExp): RepoFile | undefined {
  return ctx.files.find((f) => !isNonAuthoredPath(f.path) && pattern.test(f.path));
}

export const LOW_RISK_PATH_RE =
  /(^|\/)(tests?|__tests__|spec|specs|fixtures?|testdata|test-data|examples?|samples?|docs?|mocks?|__mocks__)(\/|$)/i;

export function isLowRiskPath(path: string): boolean {
  return LOW_RISK_PATH_RE.test(path);
}

export { plural as pluralize } from "@/lib/text";

export function findReadme(ctx: AnalysisContext): string | null {
  const root = ctx.files.find((f) => isRootFile(f.path) && /^readme(\.(md|markdown|rst|txt|adoc|org))?$/i.test(f.path));
  if (root) return root.path;
  return findPath(ctx, [".github/README.md", "docs/README.md", "docs/readme.md"]);
}

export function readmeSignals(text: string): { label: string; present: boolean }[] {
  const plain = text.replace(/<!--[\s\S]*?-->/g, "");
  const headings = plain.split(/\r?\n/).filter((l) => /^\s{0,3}#{1,6}\s+\S/.test(l) || /^\s*<h[1-6][\s>]/i.test(l));
  // reStructuredText headings: a text line followed by a line of ===, ---, ~~~ …
  const rstHeadings = (plain.match(/^[^\n]+\r?\n[=\-~^"'`#*+]{3,}\s*$/gm) ?? []).map((h) => h.split(/\r?\n/)[0]);
  const allHeadings = [...headings, ...rstHeadings].join("\n");
  const searchable = `${allHeadings}\n${plain}`;
  return [
    { label: "substantive content (at least 300 characters)", present: plain.trim().length >= 300 },
    { label: "section headings", present: headings.length + rstHeadings.length >= 2 },
    {
      label: "installation / getting-started instructions",
      present: /install|getting started|get started|quick ?start|setup|set up/i.test(searchable),
    },
    { label: "usage or examples", present: /usage|example|how to use|running|run the|demo|tutorial/i.test(searchable) },
    { label: "code block", present: /```|~~~|^\s*\.\. code(-block)?::|^ {4}\S/m.test(plain) || /<pre[\s>]/i.test(plain) },
  ];
}
