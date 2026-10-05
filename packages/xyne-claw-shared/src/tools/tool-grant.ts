export interface ToolGrantConfig {
  direct?: readonly string[];
  custom?: readonly string[];
  gateway?: readonly string[];
  subagents?: readonly string[];
  subagentServerTypes?: readonly string[];
}

export interface ToolGrantSubject {
  toolName: string;
  serverType?: string;
  serverName?: string;
  runtimeName?: string;
  selectionKey?: string;
  serviceName?: string;
}

export type ToolGrantReason =
  | "server"
  | "gateway"
  | "custom"
  | "direct-exact"
  | "direct-scoped"
  | "direct-bare"
  | "none";

export interface ToolGrantResult {
  allowed: boolean;
  reason: ToolGrantReason;
  entry?: string;
}

export function normalizeToolGrantKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseToolGrantEntry(entry: string): { server?: string; tool: string } {
  const trimmed = entry.trim();
  const idx = trimmed.indexOf("__");
  if (idx <= 0 || idx >= trimmed.length - 2) return { tool: trimmed };
  return { server: trimmed.slice(0, idx), tool: trimmed.slice(idx + 2) };
}

function nonEmpty(values: ReadonlyArray<string | undefined>): string[] {
  return values.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

export function resolveToolGrant(subject: ToolGrantSubject, config: ToolGrantConfig): ToolGrantResult {
  const servers = new Set(nonEmpty([subject.serverType, subject.serverName]).map(normalizeToolGrantKey));

  for (const entry of [...(config.subagents ?? []), ...(config.subagentServerTypes ?? [])]) {
    if (servers.has(normalizeToolGrantKey(entry))) return { allowed: true, reason: "server", entry };
  }

  for (const entry of config.gateway ?? []) {
    const key = normalizeToolGrantKey(entry);
    if ((subject.serviceName && normalizeToolGrantKey(subject.serviceName) === key) || servers.has(key)) {
      return { allowed: true, reason: "gateway", entry };
    }
  }

  if (subject.selectionKey) {
    const selection = normalizeToolGrantKey(subject.selectionKey);
    for (const entry of config.custom ?? []) {
      if (normalizeToolGrantKey(entry) === selection) return { allowed: true, reason: "custom", entry };
    }
  }

  const exact = new Set(nonEmpty([subject.runtimeName, subject.selectionKey]));
  const tool = normalizeToolGrantKey(subject.toolName);
  let bare: string | undefined;
  for (const entry of config.direct ?? []) {
    if (exact.has(entry)) return { allowed: true, reason: "direct-exact", entry };
    const parsed = parseToolGrantEntry(entry);
    if (normalizeToolGrantKey(parsed.tool) !== tool) continue;
    if (parsed.server === undefined) {
      bare ??= entry;
      continue;
    }
    if (servers.has(normalizeToolGrantKey(parsed.server))) return { allowed: true, reason: "direct-scoped", entry };
  }
  if (bare !== undefined) return { allowed: true, reason: "direct-bare", entry: bare };

  return { allowed: false, reason: "none" };
}

export function toolGrantSubjectFromRuntimeTool(tool: {
  name: string;
  mcpToolName?: string;
  serverToolKey?: string;
  selectionKey?: string;
  serviceName?: string;
}): ToolGrantSubject {
  const raw = tool.mcpToolName ?? tool.name;
  const suffix = `__${raw}`;
  const serverType =
    tool.serverToolKey && tool.serverToolKey.endsWith(suffix)
      ? tool.serverToolKey.slice(0, -suffix.length)
      : undefined;
  const serverName =
    tool.mcpToolName && tool.name.endsWith(suffix) && tool.name.length > suffix.length
      ? tool.name.slice(0, -suffix.length)
      : undefined;
  return {
    toolName: raw,
    runtimeName: tool.name,
    ...(serverType ? { serverType } : {}),
    ...(serverName ? { serverName } : {}),
    ...(tool.selectionKey ? { selectionKey: tool.selectionKey } : {}),
    ...(tool.serviceName ? { serviceName: tool.serviceName } : {}),
  };
}

const SHADOW_DEDUPE_LIMIT = 5000;
const shadowSeen = new Set<string>();

export function toolGrantShadowEnabled(): boolean {
  return process.env["TOOL_GRANT_SHADOW"] !== "0";
}

export function shadowToolGrant(input: {
  site: string;
  legacy: boolean;
  subject: ToolGrantSubject;
  config: ToolGrantConfig;
  agent?: string | null;
  log: (message: string) => void;
}): void {
  if (!toolGrantShadowEnabled()) return;
  try {
    const canonical = resolveToolGrant(input.subject, input.config);
    if (canonical.allowed === input.legacy) return;
    const key = `${input.site}|${input.agent ?? ""}|${input.subject.serverType ?? ""}|${input.subject.toolName}|${input.legacy}`;
    if (shadowSeen.has(key)) return;
    if (shadowSeen.size >= SHADOW_DEDUPE_LIMIT) shadowSeen.clear();
    shadowSeen.add(key);
    input.log(
      `[tool-grant-shadow] site=${input.site} agent=${input.agent ?? "-"} server=${JSON.stringify(input.subject.serverType ?? input.subject.serverName ?? "-")} tool=${input.subject.toolName} legacy=${input.legacy} canonical=${canonical.allowed} reason=${canonical.reason}${canonical.entry !== undefined ? ` entry=${JSON.stringify(canonical.entry)}` : ""}`,
    );
  } catch {
    return;
  }
}

export function resetToolGrantShadowForTests(): void {
  shadowSeen.clear();
}
