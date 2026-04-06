import type { McpAdapter } from "../types.js";

export const grafanaAdapter: McpAdapter = {
  type: "grafana",
  pennyDrop: { name: "search_dashboards", params: { query: "" } },
  credentialFields: [
    { name: "url", label: "Grafana URL", type: "text", placeholder: "https://your-grafana.example.com" },
    { name: "token", label: "Service Account Token", type: "password", placeholder: "glsa_xxxxxxxxxxxxxxxxxxxx" },
  ],
  buildCommand(credentials) {
    const url = credentials["url"] as string;
    const token = credentials["token"] as string;
    return {
      cmd: "uvx",
      args: ["mcp-grafana"],
      env: {
        GRAFANA_URL: url,
        GRAFANA_SERVICE_ACCOUNT_TOKEN: token,
      },
    };
  },
};
