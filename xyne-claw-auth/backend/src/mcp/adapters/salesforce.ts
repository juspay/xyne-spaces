import type { StdioMcpAdapter } from "../types.js";

export const salesforceAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "salesforce",
  healthCheck: { name: "salesforce_search_objects", params: { searchPattern: "Account" } },
  writeTools: [
    "salesforce_dml",
    "salesforce_manage_object",
    "salesforce_manage_field",
    "salesforce_manage_field_permissions",
    "salesforce_write_apex_class",
    "salesforce_write_apex_trigger",
    "salesforce_execute_anonymous_apex",
    "salesforce_write_metadata",
    "salesforce_metadata_import",
  ],
  credentialFields: [
    { name: "username", label: "Salesforce Username", type: "text", placeholder: "user@yourcompany.com" },
    { name: "password", label: "Salesforce Password", type: "password", placeholder: "your-password" },
    { name: "securityToken", label: "Security Token", type: "password", placeholder: "your-security-token" },
    { name: "instanceUrl", label: "Instance URL", type: "text", placeholder: "https://login.salesforce.com", optional: true },
  ],
  buildCommand(credentials) {
    const username = credentials["username"] as string;
    const password = credentials["password"] as string;
    const securityToken = credentials["securityToken"] as string;
    const instanceUrl = (credentials["instanceUrl"] as string) || "https://login.salesforce.com";

    return {
      cmd: "npx",
      args: ["-y", "@acquis-consulting/acquis-salesforce-mcp@1.0.5"],
      env: {
        SALESFORCE_CONNECTION_TYPE: "username_password",
        SALESFORCE_USERNAME: username,
        SALESFORCE_PASSWORD: password,
        SALESFORCE_TOKEN: securityToken,
        SALESFORCE_INSTANCE_URL: instanceUrl,
      },
    };
  },
};
