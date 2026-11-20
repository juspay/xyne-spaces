import type { StdioMcpAdapter } from "../types.js";

function validateServiceAccountJson(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "BigQuery 'keyFile' must be valid JSON — paste the full service account key JSON.",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("BigQuery 'keyFile' must be a JSON object.");
  }
  const obj = parsed as Record<string, unknown>;
  if (obj["type"] !== "service_account") {
    throw new Error(
      "BigQuery 'keyFile' must be a service account key (expected \"type\": \"service_account\").",
    );
  }
  for (const required of ["project_id", "private_key", "client_email"]) {
    if (typeof obj[required] !== "string" || (obj[required] as string).length === 0) {
      throw new Error(`BigQuery 'keyFile' is missing required field '${required}'.`);
    }
  }
  return obj;
}

export const bigqueryAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "bigquery",
  healthCheck: { name: "query", params: { sql: "SELECT 1" } },
  credentialFields: [
    { name: "projectId", label: "GCP Project ID", type: "text", placeholder: "your-gcp-project-id" },
    { name: "keyFile", label: "Service Account Key (JSON)", type: "password", placeholder: "Paste the full JSON key content" },
    { name: "location", label: "BigQuery Location", type: "text", placeholder: "us-central1", optional: true },
  ],
  buildCommand(credentials) {
    const projectId = credentials["projectId"] as string;
    const keyJson = credentials["keyFile"] as string;
    const location = (credentials["location"] as string) || "";

    validateServiceAccountJson(keyJson);

    // The key is passed as a launch file; --key-file gets its path.
    const args = ["-y", "@ergut/mcp-bigquery-server@1.0.4", "--project-id", projectId, "--key-file", "{{file:sa-key.json}}"];
    if (location) args.push("--location", location);

    return { cmd: "npx", args, env: {}, files: { "sa-key.json": keyJson } };
  },
};
