import { createMcpOAuthProvider } from "../lib/mcp-oauth-provider.js";
import { sentryRemoteAdapter } from "../mcp/adapters/sentry-remote.js";

// No `scope`: Sentry ignores it and asks the user for permissions on its own
// consent screen (see adapters/sentry-remote.ts).
const { router, callbackRouter, provider } = createMcpOAuthProvider({
  type: "sentry-remote",
  label: "Sentry",
  registerUrl: "https://mcp.sentry.dev/oauth/register",
  authUrl: "https://mcp.sentry.dev/oauth/authorize",
  tokenUrl: "https://mcp.sentry.dev/oauth/token",
  confidential: false,
  server: {
    name: "Sentry",
    url: "https://mcp.sentry.dev/mcp",
    description: "Sentry — search issues, events, traces and logs, inspect stack traces, and triage or resolve issues.",
    writeToolPolicy: { mode: "allowlist", tools: sentryRemoteAdapter.writeTools },
    healthcheckSpec: sentryRemoteAdapter.healthCheck,
  },
});

export const sentryRemoteOAuthRouter = router;
export const sentryRemoteCallbackRouter = callbackRouter;
export const sentryRemoteOAuthProvider = provider;
