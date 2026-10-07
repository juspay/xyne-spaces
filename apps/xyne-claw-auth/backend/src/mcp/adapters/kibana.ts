import type { HttpMcpAdapter } from "../types.js";

/**
 * Uses Kibana's native Agent Builder MCP endpoint, not the deprecated
 * `docker.elastic.co/mcp/elasticsearch` container (this backend has no
 * Docker CLI or socket access, so that path always failed with ENOENT).
 * Key needs the `feature_agentBuilder.read` Kibana app privilege — see
 * https://www.elastic.co/docs/explore-analyze/ai-features/agent-builder/mcp-server-api-keys
 */
export const kibanaAdapter: HttpMcpAdapter = {
  transport: "http",
  type: "kibana",
  healthCheck: { name: "__list_tools__", params: {} },
  credentialFields: [
    { name: "url", label: "Kibana URL", type: "text", placeholder: "https://your-kibana.example.com" },
    { name: "apiKey", label: "API Key", type: "password", placeholder: "Needs feature_agentBuilder.read privilege" },
  ],
  buildHttpUrl(credentials) {
    const url = (credentials["url"] as string).replace(/\/$/, "");
    const apiKey = credentials["apiKey"] as string;
    return {
      url: `${url}/api/agent_builder/mcp`,
      headers: { Authorization: `ApiKey ${apiKey}` },
    };
  },
};
