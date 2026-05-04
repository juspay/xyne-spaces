import type { StdioMcpAdapter } from "../types.js";

export const mixpanelAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "mixpanel",
  healthCheck: { name: "get_top_events", params: {} },
  credentialFields: [
    {
      name: "serviceAccountUserName",
      label: "Service Account Username",
      type: "text",
      placeholder: "service-account.xxxx.mp-service-account",
    },
    {
      name: "serviceAccountPassword",
      label: "Service Account Password",
      type: "password",
      placeholder: "Your Mixpanel service account secret",
    },
    {
      name: "projectId",
      label: "Project ID",
      type: "text",
      placeholder: "Your Mixpanel project ID (numeric)",
    },
  ],
  buildCommand(credentials) {
    const username = credentials["serviceAccountUserName"] as string;
    const password = credentials["serviceAccountPassword"] as string;
    const projectId = credentials["projectId"] as string;
    return {
      cmd: "npx",
      args: ["-y", "@mercuryml/mcp-mixpanel"],
      env: {
        SERVICE_ACCOUNT_USER_NAME: username,
        SERVICE_ACCOUNT_PASSWORD: password,
        DEFAULT_PROJECT_ID: projectId,
      },
    };
  },
};
