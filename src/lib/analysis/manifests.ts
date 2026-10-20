import { z } from "zod";
import type { RepoFile } from "./context";
import { basename, depth, isNonAuthoredPath } from "./paths";

const StringRecord = z.record(z.string(), z.unknown()).transform((rec) => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) if (typeof v === "string") out[k] = v;
  return out;
});

const PackageJsonSchema = z.looseObject({
  name: z.string().optional(),
  private: z.boolean().optional(),
  scripts: StringRecord.optional(),
  dependencies: StringRecord.optional(),
  devDependencies: StringRecord.optional(),
  peerDependencies: StringRecord.optional(),
  optionalDependencies: StringRecord.optional(),
  workspaces: z.unknown().optional(),
  packageManager: z.string().optional(),
  renovate: z.unknown().optional(),
  jest: z.unknown().optional(),
  prettier: z.unknown().optional(),
  eslintConfig: z.unknown().optional(),
  bin: z.unknown().optional(),
  main: z.string().optional(),
  exports: z.unknown().optional(),
});
export type PackageJson = z.infer<typeof PackageJsonSchema>;

export type PackageJsonParse = { ok: true; data: PackageJson } | { ok: false; error: string };

export function parsePackageJson(content: string): PackageJsonParse {
  let json: unknown;
  try {
    // Strip a UTF-8 BOM, which JSON.parse rejects but npm tolerates.
    json = JSON.parse(content.replace(/^﻿/, ""));
  } catch (e) {
    return { ok: false, error: e instanceof SyntaxError ? "Invalid JSON syntax" : "Unparseable content" };
  }
  const parsed = PackageJsonSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: "package.json is not a JSON object with the expected field types" };
  return { ok: true, data: parsed.data };
}

export function allDependencies(pkg: PackageJson): Record<string, string> {
  return {
    ...pkg.optionalDependencies,
    ...pkg.peerDependencies,
    ...pkg.devDependencies,
    ...pkg.dependencies,
  };
}

/** Manifest file name -> ecosystem. */
export const MANIFEST_ECOSYSTEMS: Record<string, string> = {
  "package.json": "JavaScript/TypeScript (npm)",
  "deno.json": "Deno",
  "deno.jsonc": "Deno",
  "pyproject.toml": "Python",
  "requirements.txt": "Python",
  "setup.py": "Python",
  "setup.cfg": "Python",
  pipfile: "Python",
  "environment.yml": "Python (conda)",
  "cargo.toml": "Rust",
  "go.mod": "Go",
  gemfile: "Ruby",
  "composer.json": "PHP",
  "pom.xml": "Java (Maven)",
  "build.gradle": "JVM (Gradle)",
  "build.gradle.kts": "JVM (Gradle)",
  "build.sbt": "Scala (sbt)",
  "pubspec.yaml": "Dart/Flutter",
  "package.swift": "Swift",
  "mix.exs": "Elixir",
  "cmakelists.txt": "C/C++ (CMake)",
  "meson.build": "C/C++ (Meson)",
  "stack.yaml": "Haskell",
  "project.clj": "Clojure",
  "deps.edn": "Clojure",
};

export function manifestEcosystem(path: string): string | null {
  const base = basename(path).toLowerCase();
  if (MANIFEST_ECOSYSTEMS[base]) return MANIFEST_ECOSYSTEMS[base];
  if (base.endsWith(".csproj") || base.endsWith(".fsproj") || base.endsWith(".sln")) return ".NET";
  if (base.endsWith(".cabal")) return "Haskell";
  if (base.endsWith(".gemspec")) return "Ruby";
  return null;
}

/** Manifests at depth <= 3, excluding vendored/generated directories, root first. */
export function findManifests(files: RepoFile[], maxResults = 40): { path: string; ecosystem: string }[] {
  const out: { path: string; ecosystem: string }[] = [];
  const sorted = [...files].sort((a, b) => depth(a.path) - depth(b.path) || a.path.localeCompare(b.path));
  for (const f of sorted) {
    if (depth(f.path) > 3 || isNonAuthoredPath(f.path)) continue;
    const eco = manifestEcosystem(f.path);
    if (eco) out.push({ path: f.path, ecosystem: eco });
    if (out.length >= maxResults) break;
  }
  return out;
}
