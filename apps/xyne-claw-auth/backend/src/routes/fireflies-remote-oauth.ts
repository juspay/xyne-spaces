import { createMcpOAuthProvider } from "../lib/mcp-oauth-provider.js";
import { firefliesRemoteAdapter } from "../mcp/adapters/fireflies-remote.js";

const { router, callbackRouter, provider } = createMcpOAuthProvider({
  type: "fireflies-remote",
  label: "Fireflies",
  registerUrl: "https://api.fireflies.ai/register",
  authUrl: "https://api.fireflies.ai/authorize",
  tokenUrl: "https://api.fireflies.ai/token",
  confidential: false,
  scope: "profile email",
  server: {
    name: "Fireflies",
    url: "https://api.fireflies.ai/mcp",
    description: "Fireflies meeting notes — search meetings, read transcripts, summaries and action items, and share or organise meetings.",
    writeToolPolicy: { mode: "allowlist", tools: firefliesRemoteAdapter.writeTools },
    healthcheckSpec: firefliesRemoteAdapter.healthCheck,
  },
});

export const firefliesRemoteOAuthRouter = router;
export const firefliesRemoteCallbackRouter = callbackRouter;
export const firefliesRemoteOAuthProvider = provider;
