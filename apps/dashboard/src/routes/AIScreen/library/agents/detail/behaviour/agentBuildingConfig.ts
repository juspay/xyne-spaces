export const CREATE_AGENT_TOOL = 'create-agent';
export const UPDATE_AGENT_TOOL = 'update-agent';

export type AgentBuildingTool = typeof CREATE_AGENT_TOOL | typeof UPDATE_AGENT_TOOL;

export interface AgentBuildingDraft {
  create: boolean;
  update: boolean;
  allTools: boolean;
}

const TOOL_LISTS = ['subagents', 'direct', 'custom', 'gateway', 'callableAgents'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

function toolsOf(config: Record<string, unknown> | undefined): Record<string, unknown> {
  return isRecord(config?.['tools']) ? config['tools'] : {};
}

function nothingSelected(tools: Record<string, unknown>): boolean {
  const palette = tools['openPalette'];
  return (
    TOOL_LISTS.every(key => strings(tools[key]).length === 0) &&
    palette !== 'read' &&
    palette !== 'all'
  );
}

export function readAgentBuilding(
  config: Record<string, unknown> | undefined,
  delegationTier: string | undefined,
): AgentBuildingDraft {
  const tools = toolsOf(config);
  if (delegationTier === 'orchestrator' && nothingSelected(tools)) {
    return { create: true, update: true, allTools: true };
  }
  const custom = strings(tools['custom']);
  return {
    create: custom.includes(CREATE_AGENT_TOOL),
    update: custom.includes(UPDATE_AGENT_TOOL),
    allTools: false,
  };
}

export function applyAgentBuildingTool(
  config: Record<string, unknown> | undefined,
  tool: AgentBuildingTool,
  enabled: boolean,
): Record<string, unknown> {
  const tools = toolsOf(config);
  const custom = strings(tools['custom']).filter(slug => slug !== tool);
  return {
    ...(config ?? {}),
    tools: { ...tools, custom: enabled ? [...custom, tool] : custom },
  };
}
