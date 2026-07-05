import type { StdioMcpAdapter } from "../types.js";

export const databricksAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "databricks",
  healthCheck: { name: "list_clusters", params: {} },
  credentialFields: [
    { name: "host", label: "Databricks Workspace URL", type: "text", placeholder: "https://your-workspace.cloud.databricks.com" },
    { name: "token", label: "Personal Access Token", type: "password", placeholder: "dapi_xxxxxxxxxxxxxxxxxxxx" },
    { name: "httpPath", label: "SQL Warehouse HTTP Path", type: "text", placeholder: "/sql/1.0/warehouses/your-warehouse-id", optional: true },
  ],
  buildCommand(credentials) {
    const host = credentials["host"] as string;
    const token = credentials["token"] as string;
    const httpPath = (credentials["httpPath"] as string) || "";

    const env: Record<string, string> = {
      DATABRICKS_HOST: host,
      DATABRICKS_TOKEN: token,
    };
    if (httpPath) {
      // The Python MCP server expects DATABRICKS_WAREHOUSE_ID (just the ID),
      // not the full HTTP path. Extract warehouse ID from paths like
      // "/sql/1.0/warehouses/c84ac7f6509ed0e7"
      const warehouseId = httpPath.split("/").pop() || httpPath;
      env["DATABRICKS_WAREHOUSE_ID"] = warehouseId;
    }

    return {
      cmd: "uvx",
      args: ["databricks-mcp-server==0.4.4"],
      env,
    };
  },
};
