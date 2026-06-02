import type { HttpMcpAdapter } from "../types.js";

/**
 * Webflow MCP adapter.
 *
 * Webflow MCP is a fully hosted HTTP endpoint at https://mcp.webflow.com/mcp.
 * Auth: OAuth 2.1 with DCR + PKCE (public client, token_endpoint_auth_method: none).
 * The stored credentials contain { clientId, accessToken, refreshToken, expires }.
 * We pass the access token as a Bearer header.
 *
 * Note: The AI-generated version of this adapter incorrectly used an API token.
 * Webflow's hosted MCP server uses OAuth — see webflow-oauth.ts for the flow.
 *
 * OAuth discovery: https://mcp.webflow.com/.well-known/oauth-authorization-server
 */
export const webflowAdapter: HttpMcpAdapter = {
  transport: "http",
  type: "webflow",
  // No form fields — connection is created exclusively via the OAuth flow.
  credentialFields: [],
  // sites_list is parameter-free and is the canonical Webflow health probe.
  healthCheck: { name: "sites_list", params: {} },
  writeTools: [
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
  buildHttpUrl(credentials) {
    return {
      url: "https://mcp.webflow.com/mcp",
      headers: {
        Authorization: `Bearer ${String(credentials["accessToken"] ?? "")}`,
      },
    };
  },
};
