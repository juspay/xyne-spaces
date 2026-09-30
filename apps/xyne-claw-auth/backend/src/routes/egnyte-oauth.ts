import { createMcpOAuthProvider } from "../lib/mcp-oauth-provider.js";

// Egnyte's actual MCP server (mcp-server.egnyte.com) is centrally hosted and
// authenticates against its own dedicated OAuth server, mcp-oauth.egnyte.com
// (confirmed via its /.well-known/oauth-authorization-server AND Egnyte's own
// docs at developers.egnyte.com/integration/cfs/api-docs/remote-mcp-server)
// — NOT Egnyte's legacy per-domain Public API OAuth
// (https://{domain}.egnyte.com/puboauth/token) this file used to implement.
// The customer's Egnyte domain/tenant is entered on Egnyte's own hosted login
// page during the OAuth redirect; nothing needs to be collected or configured
// here. Supports DCR, so no pre-registered client id/secret env vars either.
const { router, callbackRouter, provider } = createMcpOAuthProvider({
  type: "egnyte",
  label: "Egnyte",
  registerUrl: "https://mcp-oauth.egnyte.com/clients",
  authUrl: "https://mcp-oauth.egnyte.com/external/oauth2/authorize/egnyte-connect",
  tokenUrl: "https://mcp-oauth.egnyte.com/egnyte-connect/oauth2/token",
  confidential: true,
  server: {
    name: "Egnyte",
    url: "https://mcp-server.egnyte.com/mcp",
    description: "Egnyte content platform — search, manage, and collaborate on files and folders.",
    writeToolPolicy: {
      mode: "allowlist",
      tools: ["create_folder", "upload_file", "set_file_metadata", "create_comment", "create_link"],
    },
    healthcheckSpec: { name: "list_filesystem_by_path", params: { path: "/" } },
  },
});

export const egnyteOAuthRouter = router;
export const egnyteCallbackRouter = callbackRouter;
export const egnyteOAuthProvider = provider;
