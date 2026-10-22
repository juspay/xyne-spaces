/**
 * Connect-time SSRF guard for user-supplied LLM provider base URLs.
 *
 * A user's Settings → external-service base URL is validated by claw-auth when
 * it is saved, but the runtime (pi-ai model clients) and the provider probe
 * dial it much later with a plain `fetch`, which resolves DNS again. A name
 * that resolved to a public address at save time can be re-pointed at
 * 169.254.169.254 or an in-cluster service by then (DNS rebinding), and every
 * one of those requests carries the user's provider API key.
 *
 * The runtime also legitimately talks to private, in-cluster services
 * (claw-auth, Spaces, the platform LiteLLM), so a blanket "public only"
 * dispatcher would break it. Instead the global dispatcher's connect lookup is
 * guarded per HOST: hosts taken from a user-supplied base URL are registered
 * here, and every connect to one of them (first request, redirect, keep-alive
 * reconnect) must resolve only to public addresses.
 */
import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import { Agent } from "undici";
import { createPublicOnlyLookup, isBlockedIpAddress, isLoopbackAddress, type ConnectLookup } from "xyne-claw-shared";
import { LITELLM } from "./config.js";

const isProd = (): boolean => process.env["NODE_ENV"] === "production";

/** Lower-cased hostnames that came from a user-supplied base URL. */
const untrustedHosts = new Set<string>();

function stripBrackets(host: string): string {
  return host.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}

function platformOrigin(): string | null {
  try {
    return new URL(LITELLM.url).origin;
  } catch {
    return null;
  }
}

export class BlockedBaseUrlError extends Error {
  constructor(readonly baseUrl: string, reason: string) {
    super(`Provider base URL ${reason}`);
    this.name = "BlockedBaseUrlError";
  }
}

/**
 * Register a user-supplied provider base URL before it is dialled.
 *  - The platform LiteLLM origin (LITELLM_URL) is trusted and left alone.
 *  - Loopback is allowed outside production (local LiteLLM, Copilot proxy).
 *  - A literal blocked IP is refused here — Node never calls the lookup hook
 *    for an IP literal, so the connect guard cannot catch it.
 *  - A DNS name is added to the guarded set; the global dispatcher then
 *    re-checks every address it actually connects to.
 */
export function guardUserBaseUrl(baseUrl: string | undefined): void {
  if (!baseUrl) return;
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new BlockedBaseUrlError(baseUrl, "is not a valid URL");
  }
  if (parsed.origin === platformOrigin()) return;
  const host = stripBrackets(parsed.hostname);
  const loopbackName = host === "localhost" || host.endsWith(".localhost");
  if (isIP(host) !== 0 || loopbackName) {
    const isLoop = loopbackName || isLoopbackAddress(host);
    if (isLoop && !isProd()) return;
    if (loopbackName || isBlockedIpAddress(host)) {
      throw new BlockedBaseUrlError(baseUrl, `points at a blocked address (${host})`);
    }
    return;
  }
  untrustedHosts.add(host);
}

export function isGuardedHost(hostname: string): boolean {
  return untrustedHosts.has(stripBrackets(hostname));
}

/** Test hook. */
export function resetGuardedHostsForTest(): void {
  untrustedHosts.clear();
}

/**
 * `connect.lookup` for the process-wide dispatcher: guarded resolution for
 * registered user hosts, the normal system resolver for everything else.
 */
export function createScopedGuardLookup(publicOnly?: ConnectLookup): ConnectLookup {
  const guarded = publicOnly ?? createPublicOnlyLookup({ allowLoopback: !isProd() });
  return (hostname, options, callback) => {
    if (isGuardedHost(hostname)) {
      guarded(hostname, options, callback);
      return;
    }
    dnsLookup(hostname, { all: options?.all === true }, callback as never);
  };
}

/** Dedicated always-guarded dispatcher for one-off calls (the provider probe). */
export const publicOnlyAgent: Agent = new Agent({
  connect: { lookup: createPublicOnlyLookup({ allowLoopback: !isProd() }) },
});
