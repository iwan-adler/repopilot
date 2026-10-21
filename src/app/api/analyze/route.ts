import { handleAnalyzeRequest } from "@/lib/api/analyze-handler";
import { runtimeDeps } from "@/lib/api/runtime";

// The analyzer enforces its own 25 s budget; this is the platform ceiling.
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleAnalyzeRequest(request, runtimeDeps);
}
