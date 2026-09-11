import { createMcpOAuthProvider } from "../lib/mcp-oauth-provider.js";

const { router, callbackRouter, provider } = createMcpOAuthProvider({
  type: "wix",
  label: "Wix",
  registerUrl: "https://mcp.wix.com/register",
  authUrl: "https://mcp.wix.com/authorize",
  tokenUrl: "https://mcp.wix.com/token",
  confidential: false,
  server: {
    name: "Wix",
    url: "https://mcp.wix.com/mcp",
    description: "Wix integration — manage sites, CMS collections, pages, assets, and publish content.",
    writeToolPolicy: {
      mode: "allowlist",
      tools: [
        "CallWixSiteAPI",
        "CreateWixBusinessGuide",
        "ExecuteWixAPI",
        "ManageWixSite",
        "UploadImageToWixSite",
        "WixSiteBuilder",
        "pullSiteCreationJob",
      ],
    },
    healthcheckSpec: { name: "ListWixSites", params: {} },
  },
});

export const wixOAuthRouter = router;
export const wixCallbackRouter = callbackRouter;
export const wixOAuthProvider = provider;
