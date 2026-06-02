/**
 * Single source of truth for DocuSign OAuth + MCP endpoints.
 *
 * `DOCUSIGN_ENVIRONMENT=production` switches OAuth to live; anything else (incl.
 * unset) routes to the developer sandbox at account-d.docusign.com.
 */

const isProd = process.env["DOCUSIGN_ENVIRONMENT"] === "production";

export const DOCUSIGN_BASE_URL = isProd
  ? "https://account.docusign.com"
  : "https://account-d.docusign.com";

export const DOCUSIGN_AUTH_URL = `${DOCUSIGN_BASE_URL}/oauth/auth`;
export const DOCUSIGN_TOKEN_URL = `${DOCUSIGN_BASE_URL}/oauth/token`;
export const DOCUSIGN_USERINFO_URL = `${DOCUSIGN_BASE_URL}/oauth/userinfo`;

export const DOCUSIGN_MCP_URL_PROD = "https://mcp.docusign.com/mcp";
export const DOCUSIGN_MCP_URL_DEMO = "https://mcp-d.docusign.com/mcp";

export const DOCUSIGN_IS_PRODUCTION = isProd;

/** Returns the DocuSign MCP URL for a given account `base_uri`. */
export function resolveDocuSignMcpUrl(baseUri: string | undefined): string {
  // base_uri from /oauth/userinfo is the per-account API host, e.g.
  // https://demo.docusign.net (sandbox) or https://na2.docusign.net (prod).
  // We use it primarily as a sandbox/prod tiebreaker; if it's missing we fall
  // back to DOCUSIGN_ENVIRONMENT to avoid accidentally routing prod traffic
  // to the demo MCP server.
  if (baseUri && baseUri.startsWith("https://demo.docusign.net")) {
    return DOCUSIGN_MCP_URL_DEMO;
  }
  if (baseUri && baseUri.startsWith("https://")) {
    return DOCUSIGN_MCP_URL_PROD;
  }
  return isProd ? DOCUSIGN_MCP_URL_PROD : DOCUSIGN_MCP_URL_DEMO;
}

export function getDocuSignClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env["DOCUSIGN_CLIENT_ID"];
  const clientSecret = process.env["DOCUSIGN_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    throw new Error("DOCUSIGN_CLIENT_ID and DOCUSIGN_CLIENT_SECRET are required");
  }
  return { clientId, clientSecret };
}

/** Returns the Basic auth header value for DocuSign token endpoint. */
export function docuSignBasicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}
