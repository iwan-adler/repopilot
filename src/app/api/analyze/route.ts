import { createDefaultDeps, handleAnalyzeRequest } from "@/lib/api/analyze-handler";

// Per-instance state (rate limiter, concurrency gate, short-lived report cache).
const deps = createDefaultDeps();

// The analyzer enforces its own 25 s budget; this is the platform ceiling.
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleAnalyzeRequest(request, deps);
}
