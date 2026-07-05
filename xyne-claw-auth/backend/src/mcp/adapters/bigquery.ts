import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { StdioMcpAdapter } from "../types.js";

// Track temp dirs so we can best-effort clean them up on process shutdown.
// Each entry is a directory under os.tmpdir() that contains a service-account
// key written for a spawned BigQuery MCP server.
const TEMP_KEY_DIRS = new Set<string>();
let cleanupHandlersRegistered = false;

function registerCleanupHandlers(): void {
  if (cleanupHandlersRegistered) return;
  cleanupHandlersRegistered = true;

  const cleanupAll = (): void => {
    for (const dir of TEMP_KEY_DIRS) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
    TEMP_KEY_DIRS.clear();
  };

  process.once("exit", cleanupAll);
  process.once("SIGINT", () => { cleanupAll(); process.exit(130); });
  process.once("SIGTERM", () => { cleanupAll(); process.exit(143); });
}

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

    // The upstream MCP server (@ergut/mcp-bigquery-server) only accepts a file
    // path via --key-file, so the pasted JSON has to be materialised on disk
    // before spawn. We write it with mode 0600 to a fresh temp dir and rely on
    // the process-shutdown handlers below for best-effort cleanup. The OS will
    // also reclaim it when /tmp is purged.
    registerCleanupHandlers();
    const tmpDir = mkdtempSync(join(tmpdir(), "bq-mcp-"));
    const keyPath = join(tmpDir, "sa-key.json");
    writeFileSync(keyPath, keyJson, { mode: 0o600 });
    TEMP_KEY_DIRS.add(tmpDir);

    const args = ["-y", "@ergut/mcp-bigquery-server@1.0.4", "--project-id", projectId, "--key-file", keyPath];
    if (location) args.push("--location", location);

    return { cmd: "npx", args, env: {} };
  },
};
