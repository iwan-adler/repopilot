import type { DetectedItem, Stack } from "@/lib/reports/schema";
import type { BaseContext } from "./context";
import { allDependencies, findManifests, parsePackageJson, type PackageJson } from "./manifests";
import { basename, extname, isNonAuthoredPath, isRootFile, isSourceFile } from "./paths";

const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  rb: "Ruby",
  go: "Go",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  scala: "Scala",
  cs: "C#",
  fs: "F#",
  php: "PHP",
  swift: "Swift",
  m: "Objective-C",
  mm: "Objective-C++",
  c: "C",
  h: "C",
  cc: "C++",
  cpp: "C++",
  cxx: "C++",
  hpp: "C++",
  dart: "Dart",
  ex: "Elixir",
  exs: "Elixir",
  erl: "Erlang",
  hs: "Haskell",
  lua: "Lua",
  r: "R",
  jl: "Julia",
  vue: "Vue",
  svelte: "Svelte",
  astro: "Astro",
  clj: "Clojure",
  cljs: "Clojure",
  groovy: "Groovy",
  zig: "Zig",
  sol: "Solidity",
};

export function detectLanguages(
  ctx: Pick<BaseContext, "files" | "languages">,
): Pick<Stack, "languages" | "languageSource" | "primaryLanguage"> {
  let totals: Record<string, number>;
  let source: Stack["languageSource"];
  if (ctx.languages && Object.keys(ctx.languages).length > 0) {
    totals = ctx.languages;
    source = "github-linguist";
  } else {
    totals = {};
    for (const f of ctx.files) {
      if (!isSourceFile(f.path)) continue;
      const lang = EXTENSION_LANGUAGES[extname(f.path)];
      if (lang) totals[lang] = (totals[lang] ?? 0) + f.size;
    }
    source = Object.keys(totals).length > 0 ? "file-extensions" : "none";
  }
  const sum = Object.values(totals).reduce((a, b) => a + b, 0);
  const languages = Object.entries(totals)
    .map(([name, bytes]) => ({ name, bytes, percent: sum > 0 ? Math.round((bytes / sum) * 1000) / 10 : 0 }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 12);
  return { languages, languageSource: source, primaryLanguage: languages[0]?.name ?? null };
}

/** All successfully-parsed package.json files that were fetched, root first. */
export function fetchedPackageJsons(ctx: Pick<BaseContext, "contents">): { path: string; pkg: PackageJson }[] {
  const out: { path: string; pkg: PackageJson }[] = [];
  for (const [path, content] of ctx.contents) {
    if (basename(path) !== "package.json" || isNonAuthoredPath(path)) continue;
    const parsed = parsePackageJson(content);
    if (parsed.ok) out.push({ path, pkg: parsed.data });
  }
  return out.sort((a, b) => a.path.split("/").length - b.path.split("/").length);
}

// npm dependency -> framework name (first match per framework wins)
const NPM_FRAMEWORKS: [string, string][] = [
  ["next", "Next.js"],
  ["nuxt", "Nuxt"],
  ["@sveltejs/kit", "SvelteKit"],
  ["astro", "Astro"],
  ["@remix-run/react", "Remix"],
  ["@react-router/dev", "React Router"],
  ["gatsby", "Gatsby"],
  ["@angular/core", "Angular"],
  ["react-native", "React Native"],
  ["expo", "Expo"],
  ["react", "React"],
  ["vue", "Vue"],
  ["svelte", "Svelte"],
  ["solid-js", "Solid"],
  ["preact", "Preact"],
  ["@nestjs/core", "NestJS"],
  ["express", "Express"],
  ["fastify", "Fastify"],
  ["koa", "Koa"],
  ["hono", "Hono"],
  ["electron", "Electron"],
  ["vite", "Vite"],
  ["tailwindcss", "Tailwind CSS"],
  ["@tauri-apps/api", "Tauri"],
];

// Regexes over manifest text: [manifest basename, regex, framework]
const TEXT_FRAMEWORKS: [string, RegExp, string][] = [
  ["requirements.txt", /^\s*django\b/im, "Django"],
  ["requirements.txt", /^\s*flask\b/im, "Flask"],
  ["requirements.txt", /^\s*fastapi\b/im, "FastAPI"],
  ["requirements.txt", /^\s*streamlit\b/im, "Streamlit"],
  ["pyproject.toml", /["'\s]django\b/i, "Django"],
  ["pyproject.toml", /["'\s]flask\b/i, "Flask"],
  ["pyproject.toml", /["'\s]fastapi\b/i, "FastAPI"],
  ["cargo.toml", /^\s*actix-web\s*=/m, "Actix Web"],
  ["cargo.toml", /^\s*axum\s*=/m, "Axum"],
  ["cargo.toml", /^\s*rocket\s*=/m, "Rocket"],
  ["cargo.toml", /^\s*tokio\s*=/m, "Tokio"],
  ["cargo.toml", /^\s*bevy\s*=/m, "Bevy"],
  ["go.mod", /github\.com\/gin-gonic\/gin\b/, "Gin"],
  ["go.mod", /github\.com\/labstack\/echo\b/, "Echo"],
  ["go.mod", /github\.com\/gofiber\/fiber\b/, "Fiber"],
  ["go.mod", /github\.com\/spf13\/cobra\b/, "Cobra"],
  ["gemfile", /^\s*gem\s+["']rails["']/m, "Ruby on Rails"],
  ["gemfile", /^\s*gem\s+["']sinatra["']/m, "Sinatra"],
  ["composer.json", /"laravel\/framework"/, "Laravel"],
  ["composer.json", /"symfony\/framework-bundle"/, "Symfony"],
  ["pom.xml", /spring-boot/, "Spring Boot"],
  ["build.gradle", /spring-boot|org\.springframework\.boot/, "Spring Boot"],
  ["build.gradle.kts", /spring-boot|org\.springframework\.boot/, "Spring Boot"],
  ["pubspec.yaml", /^\s*flutter\s*:/m, "Flutter"],
];

// Config file (root-level basename regex) -> framework
const CONFIG_FRAMEWORKS: [RegExp, string][] = [
  [/^next\.config\.(js|mjs|cjs|ts|mts)$/, "Next.js"],
  [/^nuxt\.config\.(js|ts|mjs)$/, "Nuxt"],
  [/^svelte\.config\.(js|mjs|ts)$/, "Svelte"],
  [/^astro\.config\.(js|mjs|ts)$/, "Astro"],
  [/^angular\.json$/, "Angular"],
  [/^vite\.config\.(js|mjs|cjs|ts|mts)$/, "Vite"],
  [/^manage\.py$/, "Django"],
];

function addUnique(list: DetectedItem[], name: string, evidence: string) {
  if (!list.some((i) => i.name === name)) list.push({ name, evidence });
}

function manifestTexts(ctx: Pick<BaseContext, "contents">): { path: string; base: string; text: string }[] {
  const out: { path: string; base: string; text: string }[] = [];
  for (const [path, text] of ctx.contents) {
    if (isNonAuthoredPath(path)) continue;
    out.push({ path, base: basename(path).toLowerCase(), text });
  }
  return out;
}

// Build-time frameworks that are legitimately declared as devDependencies.
const DEV_OK_FRAMEWORKS = new Set([
  "vite",
  "tailwindcss",
  "@sveltejs/kit",
  "svelte",
  "astro",
  "electron",
  "nuxt",
  "gatsby",
  "@react-router/dev",
]);

export function detectFrameworks(ctx: Pick<BaseContext, "files" | "contents">): DetectedItem[] {
  const found: DetectedItem[] = [];
  for (const { path, pkg } of fetchedPackageJsons(ctx)) {
    // Runtime frameworks only count from dependencies/peerDependencies; a devDependency such as
    // express is usually a test helper, not the project's framework.
    const runtime = { ...pkg.peerDependencies, ...pkg.dependencies };
    const dev = pkg.devDependencies ?? {};
    for (const [dep, name] of NPM_FRAMEWORKS) {
      if (runtime[dep] !== undefined) addUnique(found, name, `"${dep}" dependency in ${path}`);
      else if (dev[dep] !== undefined && DEV_OK_FRAMEWORKS.has(dep)) addUnique(found, name, `"${dep}" devDependency in ${path}`);
    }
  }
  for (const { path, base, text } of manifestTexts(ctx)) {
    for (const [file, re, name] of TEXT_FRAMEWORKS) {
      if (base === file && re.test(text)) addUnique(found, name, `referenced in ${path}`);
    }
  }
  for (const f of ctx.files) {
    if (!isRootFile(f.path)) continue;
    for (const [re, name] of CONFIG_FRAMEWORKS) {
      if (re.test(f.path)) addUnique(found, name, `${f.path} present`);
    }
  }
  return found;
}

// npm dependency -> test framework
const NPM_TEST_FRAMEWORKS: [string, string][] = [
  ["vitest", "Vitest"],
  ["jest", "Jest"],
  ["mocha", "Mocha"],
  ["ava", "AVA"],
  ["jasmine", "Jasmine"],
  ["@playwright/test", "Playwright"],
  ["cypress", "Cypress"],
  ["karma", "Karma"],
  ["uvu", "uvu"],
  ["tap", "node-tap"],
  ["@testing-library/react", "Testing Library"],
  ["@web/test-runner", "Web Test Runner"],
];

const TEST_CONFIG_FILES: [RegExp, string][] = [
  [/(^|\/)vitest\.config\.[cm]?[jt]s$/, "Vitest"],
  [/(^|\/)vitest\.workspace\.[cm]?[jt]s$/, "Vitest"],
  [/(^|\/)jest\.config\.[cm]?[jt]s(on)?$/, "Jest"],
  [/(^|\/)\.mocharc\.(js|cjs|json|ya?ml)$/, "Mocha"],
  [/(^|\/)playwright\.config\.[cm]?[jt]s$/, "Playwright"],
  [/(^|\/)cypress\.config\.[cm]?[jt]s$/, "Cypress"],
  [/(^|\/)karma\.conf\.[jt]s$/, "Karma"],
  [/(^|\/)pytest\.ini$/, "pytest"],
  [/(^|\/)conftest\.py$/, "pytest"],
  [/(^|\/)tox\.ini$/, "tox"],
  [/(^|\/)noxfile\.py$/, "nox"],
  [/(^|\/)\.rspec$/, "RSpec"],
  [/(^|\/)spec_helper\.rb$/, "RSpec"],
  [/(^|\/)phpunit\.xml(\.dist)?$/, "PHPUnit"],
];

const TEXT_TEST_FRAMEWORKS: [string, RegExp, string][] = [
  ["pyproject.toml", /^\s*\[tool\.pytest/m, "pytest"],
  ["pyproject.toml", /["'\s]pytest\b/, "pytest"],
  ["requirements.txt", /^\s*pytest\b/im, "pytest"],
  ["setup.cfg", /^\s*\[tool:pytest\]/m, "pytest"],
  ["pom.xml", /junit/i, "JUnit"],
  ["build.gradle", /junit/i, "JUnit"],
  ["build.gradle.kts", /junit/i, "JUnit"],
  ["gemfile", /^\s*gem\s+["']rspec/m, "RSpec"],
  ["gemfile", /^\s*gem\s+["']minitest/m, "Minitest"],
  ["composer.json", /"phpunit\/phpunit"/, "PHPUnit"],
];

export function detectTestFrameworks(ctx: Pick<BaseContext, "files" | "contents">, ecosystems: string[]): DetectedItem[] {
  const found: DetectedItem[] = [];
  for (const { path, pkg } of fetchedPackageJsons(ctx)) {
    const deps = allDependencies(pkg);
    for (const [dep, name] of NPM_TEST_FRAMEWORKS) {
      if (deps[dep] !== undefined) addUnique(found, name, `"${dep}" dependency in ${path}`);
    }
    if (pkg.jest !== undefined) addUnique(found, "Jest", `"jest" config key in ${path}`);
  }
  for (const f of ctx.files) {
    if (isNonAuthoredPath(f.path)) continue;
    for (const [re, name] of TEST_CONFIG_FILES) {
      if (re.test(f.path)) addUnique(found, name, `${f.path} present`);
    }
  }
  for (const { path, base, text } of manifestTexts(ctx)) {
    for (const [file, re, name] of TEXT_TEST_FRAMEWORKS) {
      if (base === file && re.test(text)) addUnique(found, name, `referenced in ${path}`);
    }
  }
  // Toolchains with a built-in test runner.
  if (ecosystems.includes("Go")) addUnique(found, "go test (built-in)", "Go toolchain includes a test runner");
  if (ecosystems.includes("Rust")) addUnique(found, "cargo test (built-in)", "Cargo includes a test runner");
  if (ecosystems.includes("Elixir")) addUnique(found, "ExUnit (built-in)", "Mix includes ExUnit");
  if (ecosystems.includes("Deno")) addUnique(found, "deno test (built-in)", "Deno includes a test runner");
  return found;
}

const LOCKFILE_MANAGERS: [string, string][] = [
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
  ["yarn.lock", "Yarn"],
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lock", "Bun"],
  ["bun.lockb", "Bun"],
  ["poetry.lock", "Poetry"],
  ["pipfile.lock", "Pipenv"],
  ["uv.lock", "uv"],
  ["cargo.lock", "Cargo"],
  ["gemfile.lock", "Bundler"],
  ["composer.lock", "Composer"],
  ["go.sum", "Go modules"],
  ["pubspec.lock", "pub"],
  ["mix.lock", "Mix"],
];

export function detectPackageManagers(ctx: Pick<BaseContext, "files" | "contents">): DetectedItem[] {
  const found: DetectedItem[] = [];
  for (const f of ctx.files) {
    if (!isRootFile(f.path)) continue;
    const base = f.path.toLowerCase();
    for (const [lock, name] of LOCKFILE_MANAGERS) if (base === lock) addUnique(found, name, `${f.path} present`);
  }
  const root = fetchedPackageJsons(ctx).find((p) => p.path === "package.json");
  const pm = root?.pkg.packageManager;
  if (pm) {
    const name = pm.split("@")[0];
    const label = { npm: "npm", yarn: "Yarn", pnpm: "pnpm", bun: "Bun" }[name];
    if (label) addUnique(found, label, `"packageManager" field in package.json`);
  }
  return found;
}

export function detectStack(ctx: BaseContext): Stack {
  const manifests = findManifests(ctx.files);
  const ecosystems = [...new Set(manifests.map((m) => m.ecosystem))];
  return {
    ...detectLanguages(ctx),
    frameworks: detectFrameworks(ctx),
    testFrameworks: detectTestFrameworks(ctx, ecosystems),
    manifests,
    packageManagers: detectPackageManagers(ctx),
    ecosystems,
  };
}
