import { createMcpOAuthProvider } from "../lib/mcp-oauth-provider.js";

const { router, callbackRouter, provider } = createMcpOAuthProvider({
  type: "webflow",
  label: "Webflow",
  registerUrl: "https://mcp.webflow.com/oauth/register",
  authUrl: "https://mcp.webflow.com/oauth/authorize",
  tokenUrl: "https://mcp.webflow.com/oauth/token",
  confidential: false,
  server: {
    name: "Webflow",
    url: "https://mcp.webflow.com/mcp",
    description: "Webflow integration — manage sites, CMS collections, pages, assets, and publish content.",
    writeToolPolicy: {
      mode: "allowlist",
      tools: [
        "component_builder",
        "element_builder",
        "whtml_builder",
        "element_tool",
        "style_tool",
        "variable_tool",
        "de_page_tool",
        "de_component_tool",
        "asset_tool",
        "data_cms_tool",
        "data_pages_tool",
        "data_scripts_tool",
        "data_webhook_tool",
        "data_components_tool",
      ],
    },
    healthcheckSpec: { name: "sites_list", params: {} },
  },
});

export const webflowOAuthRouter = router;
export const webflowCallbackRouter = callbackRouter;
export const webflowOAuthProvider = provider;
