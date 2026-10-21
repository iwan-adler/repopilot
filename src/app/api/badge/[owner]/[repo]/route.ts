import { handleBadgeRequest } from "@/lib/badge/badge-handler";
import { imageLimiter, runtimeDeps } from "@/lib/api/runtime";

export const maxDuration = 60;

/** GET /api/badge/{owner}/{repo} → SVG score badge for README files. */
export async function GET(request: Request, ctx: RouteContext<"/api/badge/[owner]/[repo]">): Promise<Response> {
  const { owner, repo } = await ctx.params;
  return handleBadgeRequest(owner, repo, request.headers, runtimeDeps, imageLimiter, request.signal);
}
