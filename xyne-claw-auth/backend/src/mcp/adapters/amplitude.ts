import type { StdioMcpAdapter } from "../types.js";

export const amplitudeAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "amplitude",
  healthCheck: { name: "amplitude_track_event", params: { event_name: "mcp_health_check" } },
  writeTools: [
    "amplitude_track_event",
    "amplitude_track_pageview",
    "amplitude_track_signup",
    "amplitude_set_user_properties",
    "amplitude_track_revenue",
  ],
  credentialFields: [
    {
      name: "apiKey",
      label: "Amplitude API Key",
      type: "password",
      placeholder: "Your Amplitude project API key",
    },
  ],
  buildCommand(credentials) {
    const apiKey = credentials["apiKey"] as string;
    return {
      cmd: "npx",
      args: ["-y", "amplitude-mcp-server", "--api-key", apiKey],
      env: {},
    };
  },
};
