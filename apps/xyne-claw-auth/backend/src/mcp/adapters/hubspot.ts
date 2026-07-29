import type { StdioMcpAdapter } from "../types.js";

export const hubspotAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "hubspot",
  healthCheck: { name: "hubspot-get-user-details", params: {} },
  writeTools: [
    "hubspot-batch-create-objects",
    "hubspot-batch-update-objects",
    "hubspot-batch-create-associations",
    "hubspot-create-engagement",
    "hubspot-update-engagement",
    "hubspot-create-property",
    "hubspot-update-property",
  ],
  credentialFields: [
    { name: "hubspotPersonalAccessToken", label: "HubSpot Private App Access Token", type: "password", placeholder: "pat-..." },
  ],
  buildCommand(credentials) {
    const token = credentials["hubspotPersonalAccessToken"] as string;
    return {
      cmd: "npx",
      args: ["-y", "@hubspot/mcp-server@0.4.0"],
      env: {
        PRIVATE_APP_ACCESS_TOKEN: token,
      },
    };
  },
};
