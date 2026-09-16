// Tool-catalog types, copied verbatim from the claw-auth reference frontend
// (xyne-claw-auth/frontend/src/lib/api.ts) so the ported ToolboxPicker keeps
// the exact shapes it was written against.

export interface IntegrationToolEntry {
  slug: string;
  name: string;
  description: string;
  riskLevel: 'read' | 'write' | 'destructive';
}

export interface Integration {
  slug: string;
  label: string;
  kind: 'mcp' | 'builtin' | 'custom' | 'gateway';
  connected: boolean;
  /** Only populated for kind==="gateway". Lists every backendId registered under this serviceName. */
  backendIds?: string[];
  readTools: IntegrationToolEntry[];
  writeTools: IntegrationToolEntry[];
  /** How many agents select tools from this integration (popularity). */
  usageCount: number;
}

export interface AvailableTools {
  subagents: Array<{
    name: string;
    description: string;
    serverType: string;
    progressLabel: string;
  }>;
  mcpServers: Array<{ id: string; name: string; type: string }>;
  writeTools: Array<{ name: string; source: string }>;
  customGroups: Array<{ source: string; tools: Array<{ slug: string; name: string }> }>;
  serverTools: Record<string, Array<{ slug: string; name: string }>>;
  integrations: Integration[];
}

// AI-suggested tool selection from an agent's intent (system prompt or short
// description). Rendered as a proposal the user accepts/rejects before it
// touches the selection.
export interface ToolSuggestion {
  subagents: string[];
  integrations: Array<{
    slug: string;
    readTools: string[];
    writeTools: string[];
  }>;
  reasoning: Record<string, string>;
}

/** The wizard's tool selection, threaded through ToolboxPicker value/onChange. */
export interface ToolboxSelection {
  subagents: string[];
  direct: string[];
  custom: string[];
  gateway?: string[];
}

/**
 * An agent's toolbox plus the other agents it may delegate to. Kept separate
 * from ToolboxSelection because subagents and the subagent wizard share that
 * type and have no notion of calling another agent.
 */
export interface AgentToolboxSelection extends Required<ToolboxSelection> {
  callableAgents: string[];
}

/** A research-agent product or repository option (id + display name). */
export interface ResearchAgentOption {
  id: string;
  name: string;
}
