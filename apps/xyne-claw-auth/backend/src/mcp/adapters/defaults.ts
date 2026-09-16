/**
 * OSS-neutral, env-parameterized defaults for the MCP adapters.
 *
 * This repository is open-sourced: adapter defaults and credential
 * placeholder text must not disclose internal hostnames or infrastructure.
 * Internal deployments restore the internal endpoints via the environment
 * variables below; the fallbacks are local-development values, matching the
 * convention used by src/config.ts (e.g. litellmBaseUrl, spacesAppUrl).
 *
 *   BITBUCKET_BASE_URL              - Bitbucket Server base URL (bitbucket adapter)
 *   JUSBIZ_MCP_URL                  - Jusbiz Expense MCP streamable-HTTP endpoint
 *   JUSPAY_INTERNAL_TOOLS_BASE_URL  - juspay-internal-tools server base URL
 *   PUBLIC_SPACES_URL               - Xyne Spaces URL (credential placeholder hint)
 *
 * Defaults resolve at CALL time (credential placeholders bind at module
 * load) so callers and tests can override them via process.env.
 */

/** Bitbucket Server base URL used when a credential omits `baseUrl`. */
export function defaultBitbucketBaseUrl(): string {
  return process.env["BITBUCKET_BASE_URL"] ?? "http://localhost:7990";
}

/** Jusbiz Expense MCP streamable-HTTP endpoint. */
export function defaultJusbizMcpUrl(): string {
  return process.env["JUSBIZ_MCP_URL"] ?? "http://localhost:8080/jusbiz-mcp/mcp";
}

/**
 * juspay-internal-tools server base URL. Trailing slashes are tolerated
 * (stripped by the caller before joining `/tools`).
 */
export function defaultInternalToolsBaseUrl(): string {
  return process.env["JUSPAY_INTERNAL_TOOLS_BASE_URL"] ?? "http://localhost:8081/";
}

/** Xyne Spaces URL, shown as the credential placeholder hint. */
export function defaultSpacesUrl(): string {
  return process.env["PUBLIC_SPACES_URL"] ?? "http://localhost:5173";
}
