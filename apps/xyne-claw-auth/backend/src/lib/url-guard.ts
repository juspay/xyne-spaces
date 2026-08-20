/**
 * Outbound-URL guards (SSRF). Every `fetch` whose target host or scheme can be
 * influenced by request data — a body field, a query/param, a DB column that a
 * route wrote from a body — must derive its URL from one of these helpers
 * rather than from the raw string.
 *
 * Three shapes are supported:
 *   - `rebaseOnTrustedOrigin`: the caller may pick a path on one of OUR
 *     origins (internal result/progress callbacks). Scheme/host/port always
 *     come from the trusted origin string; only path + query are carried over.
 *   - `requireHost`: the URL must live on a known provider host
 *     (e.g. Slack's `hooks.slack.com`).
 *   - `resolveProviderBaseUrl`: a user-configured base URL for an
 *     OpenAI/Anthropic-compatible proxy. Mirrors the external-callback policy
 *     in surfaces/external-api/const.ts: plain http(s), never cloud metadata
 *     or link-local addresses.
 *
 * Callers that follow `fetch` with a user-influenced target should also pass
 * `redirect: "manual"` so a 3xx cannot bounce the request somewhere else.
 */

export const HTTP_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

/** Cloud metadata endpoints by name… */
const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set([
  "metadata.google.internal",
  "instance-data",
  "fd00:ec2::254",
]);
/** …and by link-local address. */
const LINK_LOCAL_IPV4_RE = /^169\.254\.\d{1,3}\.\d{1,3}$/;

export class OutboundUrlError extends Error {
  override readonly name = "OutboundUrlError";
}

/** Parse `raw` as an absolute http(s) URL without userinfo; null for anything else. */
export function parseHttpUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!HTTP_PROTOCOLS.has(parsed.protocol)) return null;
  // `https://user@host/` is never a legitimate shape for these targets and is
  // a classic way to make a URL read as one host while pointing at another.
  if (parsed.username || parsed.password) return null;
  return parsed;
}

/** Lower-cased hostname with IPv6 brackets removed. */
export function hostnameOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

/** False for cloud-metadata names and link-local IPv4 literals. */
export function isAllowedOutboundHost(url: URL): boolean {
  const hostname = hostnameOf(url);
  if (BLOCKED_HOSTNAMES.has(hostname)) return false;
  if (LINK_LOCAL_IPV4_RE.test(hostname)) return false;
  return true;
}

/**
 * Rebuild `raw` on top of whichever of `trustedOrigins` it matches. The
 * returned URL takes scheme, host and port from the trusted origin string and
 * only path + query from `raw`; null when `raw` is not on a trusted origin.
 */
export function rebaseOnTrustedOrigin(raw: unknown, trustedOrigins: readonly string[]): URL | null {
  const candidate = parseHttpUrl(raw);
  if (!candidate) return null;
  for (const trusted of trustedOrigins) {
    const base = parseHttpUrl(trusted);
    if (!base || base.origin !== candidate.origin) continue;
    return new URL(`${candidate.pathname}${candidate.search}`, base.origin);
  }
  return null;
}

/**
 * Accept `raw` only when it is an http(s) URL whose hostname is one of
 * `allowedHosts` (exact, case-insensitive). Returns the parsed URL or null.
 */
export function requireHost(raw: unknown, allowedHosts: ReadonlySet<string>): URL | null {
  const parsed = parseHttpUrl(raw);
  if (!parsed) return null;
  return allowedHosts.has(hostnameOf(parsed)) ? parsed : null;
}

/**
 * Resolve a user-configured provider base URL. Empty/undefined falls back to
 * `fallback` (a constant or config value). The result has no trailing slash so
 * callers can append `/v1/models` etc. Throws OutboundUrlError on a URL that
 * is not plain http(s) or targets a blocked host.
 */
export function resolveProviderBaseUrl(raw: string | null | undefined, fallback: string): string {
  const candidate = (raw ?? "").trim() || fallback;
  const parsed = parseHttpUrl(candidate);
  if (!parsed) {
    throw new OutboundUrlError("baseUrl must be an absolute http(s) URL");
  }
  if (!isAllowedOutboundHost(parsed)) {
    throw new OutboundUrlError("baseUrl targets a host that is not allowed");
  }
  return parsed.href.replace(/\/+$/, "");
}
