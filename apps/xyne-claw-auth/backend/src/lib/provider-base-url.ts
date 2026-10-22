import { assertSafeOutboundUrl, isLoopbackHost } from "./safe-fetch.js";

/**
 * Policy for a user-supplied LLM provider base URL (Settings → external
 * service, per-agent user config, model listing, credential verify).
 *
 * Every request to this URL carries the user's provider API key, so it is
 * held to a stricter bar than a generic outbound fetch:
 *   - https only (http would send the key in clear text). Outside production
 *     a loopback http URL is still accepted so a local LiteLLM keeps working;
 *   - public destination only — no loopback (in production), RFC1918,
 *     link-local/metadata, CGNAT, ULA or reserved ranges, checked against
 *     every DNS answer.
 *
 * Returns a human-readable reason (to be prefixed with "baseUrl "), or null
 * when the URL is acceptable. This is the save-time check; the runtime and the
 * probe additionally dial through a connect-time guard.
 */
export async function providerBaseUrlError(rawUrl: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "must be an absolute https URL";
  }
  const devLoopback = process.env["NODE_ENV"] !== "production" && isLoopbackHost(parsed.hostname);
  if (parsed.protocol !== "https:" && !(devLoopback && parsed.protocol === "http:")) {
    return "must use https";
  }
  try {
    await assertSafeOutboundUrl(rawUrl, { allowLoopbackInDev: true });
    return null;
  } catch {
    return "must be a public https endpoint";
  }
}
