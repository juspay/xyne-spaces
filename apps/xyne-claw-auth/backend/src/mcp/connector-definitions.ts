 
 import type { McpServer } from "@prisma/client";
import { prisma } from "../db.js";
import type {
  CredentialField,
  HttpLaunchConfig,
  PennyDropTool,
  ResolvedConnectorDefinition,
  StdioLaunchConfig,
  WriteToolPolicy,
} from "./types.js";
import { STATIC_ADAPTERS } from "./static-adapters.js";

import { createLogger } from "../logger.js";
const log = createLogger("connector-definitions");

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function applyTemplate(template: string, credentials: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.:-]+)\s*\}\}/g, (_m, token) => {
    if (token.startsWith("b64:")) {
      const key = token.slice(4);
      return Buffer.from(String(credentials[key] ?? "")).toString("base64");
    }
    return String(credentials[token] ?? "");
  });
}

function parseCredentialFields(row: McpServer): CredentialField[] {
  const schema = asRecord(row.credentialSchema);
  const form = asRecord(row.credentialForm);
  const fields = form["fields"];
  if (Array.isArray(fields)) {
    return fields
      .filter((f): f is Record<string, unknown> => !!f && typeof f === "object" && !Array.isArray(f))
      .map((f): CredentialField => ({
        name: String(f["name"] ?? ""),
        label: String(f["label"] ?? f["name"] ?? ""),
        type: f["type"] === "password" ? "password" : "text",
        placeholder: String(f["placeholder"] ?? ""),
        optional: Boolean(f["optional"] ?? false),
      }))
      .filter((f) => f.name.length > 0);
  }

  const properties = asRecord(schema["properties"]);
  const required = new Set(Array.isArray(schema["required"]) ? schema["required"].map((k) => String(k)) : []);
  return Object.entries(properties).map(([name, prop]) => {
    const p = asRecord(prop);
    return {
      name,
      label: String(p["title"] ?? p["label"] ?? name),
      type: (p["format"] === "password" || p["secret"] === true) ? "password" : "text",
      placeholder: String(p["placeholder"] ?? ""),
      optional: !required.has(name),
    } as CredentialField;
  });
}

function parseHealthCheck(row: McpServer): PennyDropTool {
  const spec = asRecord(row.healthcheckSpec);
  const name = spec["name"];
  const params = asRecord(spec["params"]);
  if (typeof name === "string" && name.length > 0) return { name, params };
  return { name: "ping", params: {} };
}

function parseWritePolicy(row: McpServer): WriteToolPolicy {
  const raw = asRecord(row.writeToolPolicy);
  const tools = Array.isArray(raw["tools"]) ? raw["tools"].map((t) => String(t)) : [];
  const modeRaw = String(raw["mode"] ?? "allowlist");
  const mode = (modeRaw === "denylist" || modeRaw === "allAsk" || modeRaw === "allowAll")
    ? modeRaw
    : "allowlist";
  return { mode, tools };
}

function writeToolsFromPolicy(policy: WriteToolPolicy): readonly string[] {
  if (policy.mode === "allowlist") return policy.tools ?? [];
  return [];
}

function buildDynamicDefinition(row: McpServer): ResolvedConnectorDefinition {
  const credentialFields = parseCredentialFields(row);
  const healthCheck = parseHealthCheck(row);
  const writePolicy = parseWritePolicy(row);
  const launch = asRecord(row.launchConfigTemplate);
  const http = asRecord(row.httpConfigTemplate);

  return {
    type: row.type,
    transport: row.transport === "http" ? "http" : "stdio",
    credentialFields,
    healthCheck,
    writeTools: writeToolsFromPolicy(writePolicy),
    staticTools: [],
    forwardFiles: row.forwardFiles === true,
    buildStdioCommand(credentials) {
      const envTemplate = asRecord(launch["env"]);
      const args = Array.isArray(launch["args"]) ? launch["args"].map((a) => applyTemplate(String(a), credentials)) : [];
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(envTemplate)) env[k] = applyTemplate(String(v), credentials);
      return {
        cmd: applyTemplate(String(launch["cmd"] ?? ""), credentials),
        args,
        env,
      };
    },
    buildHttpConfig(credentials) {
      const headersTemplate = asRecord(http["headers"]);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(headersTemplate)) headers[k] = applyTemplate(String(v), credentials);
      return {
        url: applyTemplate(String(http["url"] ?? ""), credentials),
        headers,
      };
    },
  };
}

function fromStaticAdapter(serverType: string): ResolvedConnectorDefinition | undefined {
  const adapter = STATIC_ADAPTERS[serverType];
  if (!adapter) return undefined;
  return {
    type: adapter.type,
    transport: adapter.transport,
    credentialFields: [...adapter.credentialFields],
    healthCheck: adapter.healthCheck,
    writeTools: adapter.writeTools ?? [],
    staticTools: adapter.staticTools ?? [],
    // Code-defined adapters don't forward files (none return binary today). Add
    // a flag to StdioMcpAdapter if one ever needs it.
    forwardFiles: false,
    buildStdioCommand(credentials): StdioLaunchConfig {
      if (adapter.transport !== "stdio") return { cmd: "", args: [], env: {} };
      const cmd = adapter.buildCommand(credentials);
      return { cmd: cmd.cmd, args: cmd.args, env: cmd.env };
    },
    buildHttpConfig(credentials): HttpLaunchConfig {
      if (adapter.transport !== "http") return { url: "", headers: {} };
      return adapter.buildHttpUrl(credentials);
    },
  };
}

/**
 * Server types that should resolve via the STATIC adapter even when an
 * mcp_servers row with launchConfigTemplate / httpConfigTemplate exists.
 *
 * Historically the resolver tried the DB row first and fell back to static.
 * f062581da5 ("XYNE-14952 linkdin mcp fix") flipped this globally — which
 * unblocked LinkedIn but silently shadowed the per-server DB customizations
 * for every other adapter (e.g. grafana lost tools for ppi-grafana-v2).
 *
 * Keep the static-first list narrow: only adapters that genuinely cannot be
 * driven from the DB row (custom buildCommand logic, env preprocessing, etc.).
 * Everything else falls through to DB-first, preserving the pre-XYNE-14952
 * behaviour.
 */
const STATIC_FIRST_TYPES = new Set<string>(["rapidapi-linkedin"]);

export async function resolveConnectorDefinition(serverType: string): Promise<ResolvedConnectorDefinition | undefined> {
  if (STATIC_FIRST_TYPES.has(serverType)) {
    const staticDef = fromStaticAdapter(serverType);
    if (staticDef) return staticDef;
  }

  const row = await prisma.mcpServer.findUnique({ where: { type: serverType } });
  if (row && row.enabled) {
    // Only use the dynamic (DB-driven) path when the row has an actual launch
    // config — launchConfigTemplate for stdio or httpConfigTemplate for http.
    // Having only credentialForm/credentialSchema is not enough: those define
    // the UI form but the static adapter may still provide the buildCommand()
    // logic (e.g. BigQuery writes a temp key file before spawning).
    const hasLaunchConfig = row.launchConfigTemplate !== null || row.httpConfigTemplate !== null;
    if (hasLaunchConfig) {
      // SECURITY: never build a stdio launch command from a DB row. A stdio
      // connector spawns a child process inside this (secrets-holding) gateway,
      // so its command must be code-reviewed. stdio types resolve via the
      // code-defined static adapter ONLY — the adapter's cmd/args are constant
      // and per-connection values (URLs, tokens) still flow through credentials,
      // so this does not drop legitimate per-server config. A DB-stored stdio
      // launchConfigTemplate (pre-existing or injected) is therefore inert.
      // http connectors don't spawn a local process, so DB-driven http stays.
      if (row.transport === "http") {
        return buildDynamicDefinition(row);
      }
      const staticDef = fromStaticAdapter(serverType);
      if (!staticDef) {
        log.warn(`[connector] ignoring DB stdio launchConfig for type=${serverType} — no code-reviewed static adapter exists; refusing to spawn`);
      }
      return staticDef;
    }
  }
  return fromStaticAdapter(serverType);
}

export async function hasConnectorDefinition(serverType: string): Promise<boolean> {
  return (await resolveConnectorDefinition(serverType)) !== undefined;
}

export async function getCredentialFieldsByServerType(): Promise<Record<string, readonly CredentialField[]>> {
  const rows = await prisma.mcpServer.findMany({ where: { enabled: true }, orderBy: { name: "asc" } });
  const map: Record<string, readonly CredentialField[]> = {};
  for (const row of rows) {
    const resolved = await resolveConnectorDefinition(row.type);
    if (resolved) map[row.type] = resolved.credentialFields;
  }
  for (const [type, adapter] of Object.entries(STATIC_ADAPTERS)) {
    if (!map[type]) map[type] = adapter.credentialFields;
  }
  return map;
}

