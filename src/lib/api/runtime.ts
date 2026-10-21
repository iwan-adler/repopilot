import { createDefaultDeps, type HandlerDeps } from "./analyze-handler";
import { SlidingWindowLimiter } from "./rate-limit";

/**
 * One set of per-instance dependencies shared by every route in this server instance,
 * so the analyze API, badges and link previews reuse the same cache and concurrency gate.
 */
export const runtimeDeps: HandlerDeps = createDefaultDeps();

/**
 * Badge and preview images are fetched by image proxies (e.g. GitHub's camo) and social
 * crawlers that share IPs, so they get a separate, more generous limit. CDN caching of
 * these responses is the main protection.
 */
export const imageLimiter = new SlidingWindowLimiter(60, 10 * 60 * 1000);
