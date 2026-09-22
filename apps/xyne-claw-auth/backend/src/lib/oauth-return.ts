/**
 * Post-OAuth return targets.
 *
 * Every OAuth callback used to redirect to a single global FRONTEND_URL (the
 * claw SPA), so a flow started from Spaces finished on claw's home page and the
 * user lost their place. The starting UI can now pass `returnTo`; the callback
 * sends the browser back there instead.
 *
 * The value is a HINT, never trusted: it arrives from the browser and is acted
 * on immediately after a credential is minted, so an unvalidated one is an open
 * redirect handing an attacker the "connected" landing. Anything that isn't an
 * allowed origin silently falls back to the old FRONTEND_URL behaviour.
 */

import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("oauth-return");

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** Origins a post-OAuth redirect may target. */
function allowedOrigins(): Set<string> {
  const configured = (process.env["OAUTH_RETURN_ORIGINS"] ?? "")
    .split(",")
    .map((entry) => originOf(entry.trim()))
    .filter((entry): entry is string => !!entry);

  return new Set(
    [
      originOf(CONFIG.frontendUrl),
      originOf(CONFIG.spacesAppUrl),
      ...configured,
    ].filter((entry): entry is string => !!entry),
  );
}

/**
 * Dev convenience: the local dashboard (:5173) is not any configured origin —
 * SPACES_APP_URL points at the API (:3001) — so a localhost return would fall
 * back to claw and the flow would look broken on every developer's machine.
 * Production stays strictly on the allowlist.
 */
function isDevLoopback(origin: string): boolean {
  if (process.env["NODE_ENV"] === "production") return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

/** The default target — exactly what every callback did before `returnTo`. */
export function defaultOAuthReturn(): string {
  return process.env["FRONTEND_URL"] ?? "http://localhost:5174/claw/";
}

/**
 * Validate a client-supplied `returnTo`. Returns the default whenever it is
 * absent, unparseable, or points somewhere we don't serve.
 */
export function resolveOAuthReturn(candidate: unknown): string {
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    return defaultOAuthReturn();
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate.trim());
  } catch {
    log.warn("[oauth-return] ignoring unparseable returnTo");
    return defaultOAuthReturn();
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    log.warn(`[oauth-return] ignoring returnTo with protocol ${parsed.protocol}`);
    return defaultOAuthReturn();
  }
  if (!allowedOrigins().has(parsed.origin) && !isDevLoopback(parsed.origin)) {
    log.warn(`[oauth-return] ignoring returnTo outside the allowlist: ${parsed.origin}`);
    return defaultOAuthReturn();
  }
  return parsed.toString();
}

/**
 * Append the connected/error marker the UIs poll for. Uses URL rather than
 * string concatenation because a returnTo legitimately carries its own query
 * (e.g. /ai/library?tab=agents) and `?x=y` would corrupt it.
 */
export function withOAuthResult(base: string, key: string, value: string): string {
  try {
    const url = new URL(base);
    url.searchParams.set(key, value);
    return url.toString();
  } catch {
    return `${base}?${key}=${encodeURIComponent(value)}`;
  }
}
