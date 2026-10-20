import { z } from "zod";
import { MAX_INPUT_LENGTH } from "@/lib/github/parse-url";

/** Body of POST /api/analyze. Unknown keys are rejected. */
export const AnalyzeRequestSchema = z.strictObject({
  url: z.string().min(1, "Enter a GitHub repository URL.").max(MAX_INPUT_LENGTH, "That URL is too long."),
});
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export const MAX_REQUEST_BODY_BYTES = 2048;
