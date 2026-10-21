#!/usr/bin/env node
/**
 * Re-fetches GitHub community profiles that failed during collection (e.g. the unauthenticated
 * 60 requests/hour limit) using the GitHub CLI, which uses the caller's own `gh auth` session.
 *
 * Usage: node scripts/validation/fill-community.mjs [docs/validation/results.json]
 */
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const file = process.argv[2] ?? "docs/validation/results.json";
const data = JSON.parse(await readFile(file, "utf8"));
let filled = 0;
for (const r of data.results) {
  if (!r.community.error) continue;
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(r.repo)) continue;
  try {
    const out = execFileSync("gh", ["api", `repos/${r.repo}/community/profile`], { encoding: "utf8" });
    const files = JSON.parse(out).files ?? {};
    r.community = {
      readme: Boolean(files.readme),
      license: Boolean(files.license),
      contributing: files.contributing?.html_url ?? null,
      refetched: true,
    };
    filled++;
  } catch (e) {
    console.error(`${r.repo}: ${String(e).slice(0, 120)}`);
  }
}
await writeFile(file, JSON.stringify(data, null, 2) + "\n");
console.log(`Filled ${filled} community profile(s).`);
