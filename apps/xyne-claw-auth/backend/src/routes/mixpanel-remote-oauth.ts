import { createMcpOAuthProvider } from "../lib/mcp-oauth-provider.js";
import { mixpanelRemoteAdapter } from "../mcp/adapters/mixpanel-remote.js";

const { router, callbackRouter, provider } = createMcpOAuthProvider({
  type: "mixpanel-remote",
  label: "Mixpanel",
  registerUrl: "https://mixpanel.com/oauth/mcp/register/",
  authUrl: "https://mixpanel.com/oauth/authorize",
  tokenUrl: "https://mixpanel.com/oauth/token/",
  confidential: false,
  // Every scope the server advertises (scopes_supported) — what mcp-remote
  // requests by default.
  scope: [
    "projects", "analysis", "events", "insights", "segmentation", "retention",
    "data:read", "funnels", "flows", "data_definitions", "alerts", "annotations",
    "bookmarks", "business_context", "cohorts", "context", "custom_alerts",
    "custom_events", "custom_properties", "dashboard_reports", "experiments",
    "feature_flags", "metrics", "user_details",
  ].join(" "),
  server: {
    name: "Mixpanel",
    url: "https://mcp.mixpanel.com/mcp",
    description: "Mixpanel product analytics (US region) — run queries, explore events, funnels, retention, cohorts, dashboards, experiments and feature flags.",
    writeToolPolicy: { mode: "allowlist", tools: mixpanelRemoteAdapter.writeTools },
    healthcheckSpec: mixpanelRemoteAdapter.healthCheck,
  },
});

export const mixpanelRemoteOAuthRouter = router;
export const mixpanelRemoteCallbackRouter = callbackRouter;
export const mixpanelRemoteOAuthProvider = provider;
