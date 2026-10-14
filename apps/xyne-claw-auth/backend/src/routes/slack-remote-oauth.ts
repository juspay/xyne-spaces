import { createClassicOAuthProvider } from "../lib/classic-oauth-provider.js";

// Slack's MCP server (mcp.slack.com) requires a registered Slack app (internal
// or directory-published) and has no dynamic client registration. Create the app
// with the redirect URL `<AUTH_SERVICE_URL>/claw/api/v1/slack-remote/callback`,
// enable MCP in its settings, and set SLACK_MCP_CLIENT_ID / SLACK_MCP_CLIENT_SECRET.
// Endpoints from https://mcp.slack.com/.well-known/oauth-authorization-server.
// Tokens are user tokens, so tool calls run as the connecting user.
const DEFAULT_SCOPES = [
  "search:read.public",
  "search:read.private",
  "search:read.users",
  "channels:history",
  "channels:read",
  "groups:history",
  "groups:read",
  "im:history",
  "mpim:history",
  "users:read",
  "users:read.email",
  "chat:write",
  "canvases:read",
].join(",");

const { router, callbackRouter, provider, ensureServer } = createClassicOAuthProvider({
  type: "slack-remote",
  label: "Slack",
  clientIdEnv: "SLACK_MCP_CLIENT_ID",
  clientSecretEnv: "SLACK_MCP_CLIENT_SECRET",
  authUrl: "https://slack.com/oauth/v2_user/authorize",
  tokenUrl: "https://slack.com/api/oauth.v2.user.access",
  scope: process.env["SLACK_MCP_SCOPES"] ?? DEFAULT_SCOPES,
  rotatesRefreshToken: true,
  server: {
    name: "Slack (OAuth)",
    url: "https://mcp.slack.com/mcp",
    description: "Slack integration over OAuth — search and read messages, channels and canvases, and post messages, as the connecting user.",
  },
});

export const slackRemoteOAuthRouter = router;
export const slackRemoteCallbackRouter = callbackRouter;
export const slackRemoteOAuthProvider = provider;
export const slackRemoteEnsureServer = ensureServer;
