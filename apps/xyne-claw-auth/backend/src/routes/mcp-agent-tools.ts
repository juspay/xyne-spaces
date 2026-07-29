import type { AgentToolsConfig } from "xyne-claw-shared";
import { getSubagentDefinition } from "xyne-claw-shared";
import type { McpServerTools, McpToolInfo } from "../mcp/types.js";
import {
  gatewayCatalogSource,
  gatewayToolSelectionKey,
  parseGatewayCatalogSource,
  parseGatewayToolSelectionKey,
} from "../mcpgateway/key-format.js";

export type GatewayServerTarget = { serviceName: string; backendId?: string };

export function normToolKey(value: string): string {
  return value.toLowerCase().replace(/_/g, "-");
}

type KeySet = {
  exact: Set<string>;
  norm: Set<string>;
};

export type AgentToolAllowSet = {
  serverExact: Set<string>;
  serverNorm: Set<string>;
  toolExact: Set<string>;
  toolNorm: Set<string>;
  customExact: Set<string>;
  customNorm: Set<string>;
  scopedToolExact: Set<string>;
  scopedToolNorm: Set<string>;
  gatewayServices: Set<string>;
  gatewaySources: Set<string>;
  gatewayToolKeys: Set<string>;
};

function addAllowKey(exact: Set<string>, norm: Set<string>, value: string | undefined): void {
  const trimmed = value?.trim();
  if (!trimmed) return;
  exact.add(trimmed);
  norm.add(normToolKey(trimmed));
}

function hasAllowKey(exact: Set<string>, norm: Set<string>, value: string | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return false;
  return exact.has(trimmed) || norm.has(normToolKey(trimmed));
}

function addScopedToolKey(set: AgentToolAllowSet, serverKey: string | undefined, toolKey: string | undefined): void {
  const server = serverKey?.trim();
  const tool = toolKey?.trim();
  if (!server || !tool) return;
  addAllowKey(set.scopedToolExact, set.scopedToolNorm, `${server}\u0000${tool}`);
}

function hasScopedToolKey(set: AgentToolAllowSet, serverKey: string | undefined, toolKey: string | undefined): boolean {
  const server = serverKey?.trim();
  const tool = toolKey?.trim();
  if (!server || !tool) return false;
  return hasAllowKey(set.scopedToolExact, set.scopedToolNorm, `${server}\u0000${tool}`);
}

function parseScopedDoubleUnderscore(entry: string): { serverKey: string; toolName: string } | null {
  const idx = entry.indexOf("__");
  if (idx <= 0 || idx >= entry.length - 2) return null;
  return {
    serverKey: entry.slice(0, idx),
    toolName: entry.slice(idx + 2),
  };
}

export function buildAgentToolAllowSet(config: AgentToolsConfig): AgentToolAllowSet {
  const allow: AgentToolAllowSet = {
    serverExact: new Set(),
    serverNorm: new Set(),
    toolExact: new Set(),
    toolNorm: new Set(),
    customExact: new Set(),
    customNorm: new Set(),
    scopedToolExact: new Set(),
    scopedToolNorm: new Set(),
    gatewayServices: new Set(),
    gatewaySources: new Set(),
    gatewayToolKeys: new Set(),
  };

  for (const entry of config.subagents ?? []) {
    addAllowKey(allow.serverExact, allow.serverNorm, entry);
    const definition = getSubagentDefinition(entry);
    addAllowKey(allow.serverExact, allow.serverNorm, definition?.serverType);
  }

  for (const entry of config.direct ?? []) {
    const gatewayTool = parseGatewayToolSelectionKey(entry);
    if (gatewayTool) {
      const key = gatewayToolSelectionKey(gatewayTool.serviceName, gatewayTool.backendId, gatewayTool.toolName);
      allow.gatewayToolKeys.add(key);
      addScopedToolKey(allow, gatewayTool.source, gatewayTool.toolName);
      addScopedToolKey(allow, `${gatewayTool.serviceName}/${gatewayTool.backendId}`, gatewayTool.toolName);
      continue;
    }

    const scoped = parseScopedDoubleUnderscore(entry);
    if (scoped) {
      addScopedToolKey(allow, scoped.serverKey, scoped.toolName);
      continue;
    }

    addAllowKey(allow.toolExact, allow.toolNorm, entry);
  }

  for (const entry of config.custom ?? []) {
    addAllowKey(allow.customExact, allow.customNorm, entry);
  }

  for (const entry of config.gateway ?? []) {
    const gatewaySource = parseGatewayCatalogSource(entry);
    if (gatewaySource) {
      allow.gatewaySources.add(gatewaySource.source);
      allow.gatewayServices.add(gatewaySource.serviceName);
      addAllowKey(allow.serverExact, allow.serverNorm, gatewaySource.source);
      addAllowKey(allow.serverExact, allow.serverNorm, gatewaySource.serviceName);
      continue;
    }
    addAllowKey(allow.serverExact, allow.serverNorm, entry);
    allow.gatewayServices.add(entry);
  }

  return allow;
}

export function isMcpServerAllowedByAgentAllowSet(
  allow: AgentToolAllowSet,
  serverType: string,
  serverName: string,
  parseGatewayServerType: (serverType: string) => GatewayServerTarget | null,
): boolean {
  if (
    hasAllowKey(allow.serverExact, allow.serverNorm, serverType) ||
    hasAllowKey(allow.serverExact, allow.serverNorm, serverName)
  ) {
    return true;
  }

  const gatewayTarget = parseGatewayServerType(serverType);
  return !!gatewayTarget && (
    allow.gatewayServices.has(gatewayTarget.serviceName) ||
    (gatewayTarget.backendId ? allow.gatewaySources.has(gatewayCatalogSource(gatewayTarget.serviceName, gatewayTarget.backendId)) : false)
  );
}

export function isMcpToolAllowedByAgentAllowSet(
  allow: AgentToolAllowSet,
  serverType: string,
  serverName: string,
  tool: Pick<McpToolInfo, "name" | "selectionKey">,
  parseGatewayServerType: (serverType: string) => GatewayServerTarget | null,
): boolean {
  if (isMcpServerAllowedByAgentAllowSet(allow, serverType, serverName, parseGatewayServerType)) return true;

  const gatewayTarget = parseGatewayServerType(serverType);
  if (gatewayTarget) {
    if (allow.gatewayServices.has(gatewayTarget.serviceName)) return true;
    if (gatewayTarget.backendId && allow.gatewayToolKeys.has(gatewayToolSelectionKey(gatewayTarget.serviceName, gatewayTarget.backendId, tool.name))) {
      return true;
    }
  }

  const scopedCandidates = [
    [serverType, tool.name],
    [serverName, tool.name],
    [serverType, tool.selectionKey],
    [serverName, tool.selectionKey],
  ] as const;
  if (scopedCandidates.some(([serverKey, toolKey]) => hasScopedToolKey(allow, serverKey, toolKey))) {
    return true;
  }

  const candidates = [
    tool.name,
    tool.selectionKey,
    `${serverType}__${tool.name}`,
    `${serverName}__${tool.name}`,
    `${serverType}:${tool.name}`,
    `${serverName}:${tool.name}`,
    `${serverType}/${tool.name}`,
    `${serverName}/${tool.name}`,
    `${serverType}-${tool.name}`,
    `${serverName}-${tool.name}`,
  ];
  if (candidates.some((candidate) => hasAllowKey(allow.toolExact, allow.toolNorm, candidate))) {
    return true;
  }

  const customCandidates = [
    tool.selectionKey,
    serverType === "claw-builtin" || serverName === "Built-in" ? tool.name : undefined,
  ];
  return customCandidates.some((candidate) => hasAllowKey(allow.customExact, allow.customNorm, candidate));
}

export function isMcpToolAllowedByAgentConfig(
  config: AgentToolsConfig | undefined,
  serverType: string,
  serverName: string,
  toolNameOrInfo: string | Pick<McpToolInfo, "name" | "selectionKey">,
  parseGatewayServerType: (serverType: string) => GatewayServerTarget | null,
): boolean {
  if (!config) return true;
  const tool = typeof toolNameOrInfo === "string" ? { name: toolNameOrInfo } : toolNameOrInfo;
  return isMcpToolAllowedByAgentAllowSet(buildAgentToolAllowSet(config), serverType, serverName, tool, parseGatewayServerType);
}

export function shouldBypassMcpToolAgentFilter(serverType: string): boolean {
  return serverType === "knowledge-base";
}

/**
 * Tool references made by a CUSTOM subagent definition (subagent_definitions
 * row). Custom subagents pick tools by bare tool name (tools.direct) and by
 * custom-tool slug (tools.custom) — see resolveCustomSubagentTools in
 * xyne-claw/src/subagent-tools.ts. Strict agent-tool enforcement must NOT
 * drop a server whose tools a custom subagent references: the parent agent's
 * own selection legitimately omits them (access is delegated through the
 * subagent), but buildSubagentTools resolves the subagent against the
 * post-enforcement groups — dropping the server silently disables the
 * subagent (resolved-to-0-tools skip).
 */
export type SubagentToolRefs = {
  name: string;
  toolNorm: Set<string>;
  customNorm: Set<string>;
};

export function buildSubagentToolRefs(
  defs: Array<{ name: string; tools: unknown }>,
): SubagentToolRefs[] {
  const refs: SubagentToolRefs[] = [];
  for (const def of defs) {
    const tools = def.tools;
    if (!tools || typeof tools !== "object") continue;
    const config = tools as AgentToolsConfig;
    const toolNorm = new Set<string>();
    for (const entry of config.direct ?? []) {
      const trimmed = entry?.trim();
      if (!trimmed) continue;
      const scoped = parseScopedDoubleUnderscore(trimmed);
      toolNorm.add(normToolKey(scoped ? scoped.toolName : trimmed));
    }
    const customNorm = new Set<string>();
    for (const entry of config.custom ?? []) {
      const trimmed = entry?.trim();
      if (!trimmed) continue;
      customNorm.add(normToolKey(trimmed));
    }
    if (toolNorm.size > 0 || customNorm.size > 0) {
      refs.push({ name: def.name, toolNorm, customNorm });
    }
  }
  return refs;
}

/**
 * Returns the name of the first custom subagent whose tools config references
 * this tool, or null. Matches the same identifiers resolveCustomSubagentTools
 * uses on the runtime side: the bare tool name (after any `server__` prefix)
 * for direct picks, and the selection key / name for custom-tool slugs.
 */
export function subagentReferencingTool(
  refs: SubagentToolRefs[],
  tool: Pick<McpToolInfo, "name" | "selectionKey">,
): string | null {
  if (refs.length === 0) return null;
  const nameKeys: string[] = [];
  const pushKey = (value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) nameKeys.push(normToolKey(trimmed));
  };
  pushKey(tool.name);
  const scoped = parseScopedDoubleUnderscore(tool.name);
  if (scoped) pushKey(scoped.toolName);
  pushKey(tool.selectionKey);
  for (const ref of refs) {
    if (nameKeys.some((key) => ref.toolNorm.has(key) || ref.customNorm.has(key))) {
      return ref.name;
    }
  }
  return null;
}

export function filterMcpServerToolsForAgentConfig(
  serverTools: McpServerTools,
  config: AgentToolsConfig | undefined,
  parseGatewayServerType: (serverType: string) => GatewayServerTarget | null,
  subagentRefs?: SubagentToolRefs[],
  /** Out-param: names of custom subagents whose references kept tools alive on this server. */
  retainedForSubagents?: Set<string>,
): McpServerTools | null {
  if (!config) return serverTools;
  if (shouldBypassMcpToolAgentFilter(serverTools.serverType)) return serverTools;
  const allow = buildAgentToolAllowSet(config);
  if (isMcpServerAllowedByAgentAllowSet(allow, serverTools.serverType, serverTools.serverName, parseGatewayServerType)) {
    return serverTools;
  }
  const tools = serverTools.tools.filter((tool) => {
    if (isMcpToolAllowedByAgentAllowSet(allow, serverTools.serverType, serverTools.serverName, tool, parseGatewayServerType)) {
      return true;
    }
    const subagent = subagentRefs ? subagentReferencingTool(subagentRefs, tool) : null;
    if (subagent) {
      retainedForSubagents?.add(subagent);
      return true;
    }
    return false;
  });
  if (tools.length === 0) return null;
  const keptToolNames = new Set(tools.map((tool) => tool.name));
  return { ...serverTools, tools, writeTools: serverTools.writeTools.filter((toolName) => keptToolNames.has(toolName)) };
}
