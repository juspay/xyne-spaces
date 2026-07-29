import type { StdioMcpAdapter } from "../types.js";

export const kibanaAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "kibana",
  healthCheck: { name: "list_indices", params: {} },
  credentialFields: [
    { name: "url", label: "Elasticsearch URL", type: "text", placeholder: "https://your-elasticsearch.example.com" },
    { name: "apiKey", label: "API Key", type: "password", placeholder: "Enter your Elasticsearch API key" },
  ],
  buildCommand(credentials) {
    const url = credentials["url"] as string;
    const apiKey = credentials["apiKey"] as string;
    return {
      cmd: "docker",
      args: [
        "run", "--rm", "-i",
        "-e", "ES_URL",
        "-e", "ES_API_KEY",
        "docker.elastic.co/mcp/elasticsearch:0.4.6",
        "stdio",
      ],
      env: {
        ES_URL: url,
        ES_API_KEY: apiKey,
      },
    };
  },
};
