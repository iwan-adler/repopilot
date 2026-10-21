import { ImageResponse } from "next/og";
import { headers } from "next/headers";
import { getCachedReport } from "@/lib/api/analyze-handler";
import { clientKey } from "@/lib/api/rate-limit";
import { imageLimiter, runtimeDeps } from "@/lib/api/runtime";
import { parseGitHubRepoUrl } from "@/lib/github/parse-url";
import { OG_SIZE, RepoOgCard } from "@/lib/og/og-card";
import type { Report } from "@/lib/reports/schema";

export const alt = "RepoPilot repository health report";
export const size = OG_SIZE;
export const contentType = "image/png";

/** Per-repository preview with the real score; falls back to a generic card on any failure. */
export default async function Image({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const parsed = parseGitHubRepoUrl(`${decodeURIComponent(owner)}/${decodeURIComponent(repo)}`);
  const fullName = parsed.ok ? `${parsed.value.owner}/${parsed.value.repo}` : "GitHub repository";
  let report: Report | null = null;
  if (parsed.ok && imageLimiter.check(clientKey(await headers())).allowed) {
    try {
      report = await getCachedReport(parsed.value.owner, parsed.value.repo, runtimeDeps);
    } catch {
      report = null;
    }
  }
  return new ImageResponse(<RepoOgCard fullName={fullName} report={report} />, {
    ...size,
    headers: { "Cache-Control": "public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400" },
  });
}
