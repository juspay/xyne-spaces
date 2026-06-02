import type { HttpMcpAdapter } from "../types.js";
import { resolveDocuSignMcpUrl } from "../../lib/docusign-config.js";

/**
 * DocuSign MCP adapter.
 *
 * DocuSign MCP is a fully hosted HTTP endpoint.
 *   Demo/sandbox: https://mcp-d.docusign.com/mcp
 *   Production:   https://mcp.docusign.com/mcp
 *
 * Tool names use camelCase as returned by the server.
 * Auth: Confidential Authorization Code Grant — pass access token as Bearer.
 *
 * The connection's `baseUri` (from /oauth/userinfo) selects sandbox vs prod.
 * If `baseUri` is missing we defer to DOCUSIGN_ENVIRONMENT rather than
 * silently routing prod traffic to the sandbox MCP server.
 */
export const docusignAdapter: HttpMcpAdapter = {
  transport: "http",
  type: "docusign",
  credentialFields: [],
  healthCheck: { name: "getUserInfo", params: {} },
  writeTools: [
    // Envelopes
    "createEnvelope",
    "updateEnvelope",
    // Maestro workflows
    "triggerWorkflow",
    "cancelWorkflowInstance",
    "pauseNewWorkflowInstances",
    "resumeWorkflow",
    // Data Verification
    "installDVApps",
  ],
  buildHttpUrl(credentials) {
    const accessToken = credentials["accessToken"];
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      throw new Error("DocuSign credentials missing accessToken");
    }
    const baseUri = typeof credentials["baseUri"] === "string" ? credentials["baseUri"] : undefined;
    return {
      url: resolveDocuSignMcpUrl(baseUri),
      headers: { Authorization: `Bearer ${accessToken}` },
    };
  },
};
