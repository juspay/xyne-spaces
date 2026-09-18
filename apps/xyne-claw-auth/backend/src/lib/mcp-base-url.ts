/**
 * Validation for a credential-supplied MCP endpoint (`baseUrl`).
 *
 * Some connectors (e.g. Juspay Ops Dashboard) exist as one logical connector
 * fronting SEVERAL stack-specific endpoints. For those, the `mcp_servers` row
 * keeps `httpConfigTemplate.url = "{{baseUrl}}"` and each agent pins its own
 * endpoint + key through an AgentMcpConnection. That moves an outbound URL from
 * an admin-only field to something any agent owner/contributor can set, so it
 * must be validated at write time:
 *
 *  - absolute http(s) only (no file:, no relative path that would silently
 *    resolve against the gateway),
 *  - no embedded credentials / fragment,
 *  - optional host allowlist via MCP_BASE_URL_ALLOWED_HOSTS (comma-separated
 *    hosts or `.suffix` entries). Unset = no host restriction, preserving
 *    today's behaviour for every existing connector.
 */

const ALLOWED_HOSTS_ENV = "MCP_BASE_URL_ALLOWED_HOSTS";

function allowedHostPatterns(): string[] {
  return String(process.env[ALLOWED_HOSTS_ENV] ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
}

function hostAllowed(host: string, patterns: string[]): boolean {
  if (patterns.length === 0) return true;
  const h = host.toLowerCase();
  return patterns.some((p) => (p.startsWith(".") ? h.endsWith(p) || h === p.slice(1) : h === p));
}

/** Returns an error message, or null when the value is acceptable. */
export function validateMcpBaseUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "baseUrl must be a non-empty string";
  }
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return "baseUrl must be an absolute http(s) URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "baseUrl must use http or https";
  }
  if (parsed.username || parsed.password) {
    return "baseUrl must not embed credentials";
  }
  if (parsed.hash) {
    return "baseUrl must not contain a fragment";
  }
  const patterns = allowedHostPatterns();
  if (!hostAllowed(parsed.hostname, patterns)) {
    return `baseUrl host "${parsed.hostname}" is not in ${ALLOWED_HOSTS_ENV}`;
  }
  return null;
}

/**
 * Validate the `baseUrl` field of a credentials blob when present. Connectors
 * that don't use credential-supplied endpoints are unaffected.
 */
export function validateCredentialBaseUrl(credentials: Record<string, unknown>): string | null {
  if (!("baseUrl" in credentials)) return null;
  return validateMcpBaseUrl(credentials["baseUrl"]);
}
