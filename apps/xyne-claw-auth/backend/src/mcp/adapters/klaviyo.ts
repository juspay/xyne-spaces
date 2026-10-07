import type { StdioMcpAdapter } from "../types.js";

// Mirrors the live prod DB row's launchConfigTemplate exactly. Unpinned
// `@latest` — same exposure class as the Databricks/mcp SDK-drift bug; a
// breaking klaviyo-mcp-server release could silently crash this the same way.
export const klaviyoAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "klaviyo",
  healthCheck: { name: "__list_tools__", params: {} },
  credentialFields: [
    { name: "apiKey", label: "Private API Key", type: "password", placeholder: "pk_..." },
  ],
  writeTools: [
    "klaviyo_create_campaign",
    "klaviyo_create_email_template",
    "klaviyo_create_event",
    "klaviyo_create_profile",
    "klaviyo_assign_template_to_campaign_message",
    "klaviyo_subscribe_profile_to_marketing",
    "klaviyo_unsubscribe_profile_from_marketing",
    "klaviyo_update_profile",
    "klaviyo_upload_image_from_file",
    "klaviyo_upload_image_from_url",
  ],
  buildCommand(credentials) {
    return {
      cmd: "uvx",
      args: ["klaviyo-mcp-server@latest"],
      env: { PRIVATE_API_KEY: credentials["apiKey"] as string },
    };
  },
};
