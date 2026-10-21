import { AnalysisError } from "@/lib/analysis/analyze-repository";
import { BusyError, getCachedReport, type HandlerDeps } from "@/lib/api/analyze-handler";
import { clientKey, type SlidingWindowLimiter } from "@/lib/api/rate-limit";
import { GitHubError } from "@/lib/github/client";
import { parseGitHubRepoUrl } from "@/lib/github/parse-url";
import { renderBadge, scoreBadgeColor } from "./render-badge";

const LABEL = "RepoPilot";
const GREY = "#6e7781";

/** CDN caching is the main protection against README traffic re-running scans. */
const CACHE_OK = "public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400";
const CACHE_SHORT = "public, max-age=60, s-maxage=60";
const CACHE_LONG = "public, max-age=86400, s-maxage=86400";

function svg(message: string, color: string, cacheControl: string): Response {
  return new Response(renderBadge({ label: LABEL, message, color }), {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
      // The SVG never needs scripts or external resources.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}

/**
 * Always responds with a valid SVG (status 200) so a README never shows a broken image;
 * the message explains failures. Never exposes internal error details.
 */
export async function handleBadgeRequest(
  ownerParam: string,
  repoParam: string,
  headers: Headers,
  deps: HandlerDeps,
  limiter: SlidingWindowLimiter,
  signal?: AbortSignal,
): Promise<Response> {
  const repo = repoParam.replace(/\.svg$/i, "");
  const parsed = parseGitHubRepoUrl(`${ownerParam}/${repo}`);
  if (!parsed.ok) return svg("invalid repository", GREY, CACHE_LONG);
  if (!limiter.check(clientKey(headers)).allowed) return svg("rate limited", GREY, CACHE_SHORT);

  try {
    const report = await getCachedReport(parsed.value.owner, parsed.value.repo, deps, signal);
    const score = report.score.overall;
    if (score === null) return svg("n/a", GREY, CACHE_OK);
    return svg(`${Math.round(score)} · ${report.score.band}`, scoreBadgeColor(score), CACHE_OK);
  } catch (err) {
    if (err instanceof GitHubError && err.code === "not_found") return svg("not found", GREY, "public, max-age=600, s-maxage=600");
    if (err instanceof AnalysisError) return svg(err.code === "empty_repository" ? "empty repository" : "private", GREY, CACHE_LONG);
    if (err instanceof BusyError) return svg("busy, retry", GREY, CACHE_SHORT);
    return svg("unavailable", GREY, CACHE_SHORT);
  }
}
