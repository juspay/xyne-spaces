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

/** Capability hubs the suggest-tools call can decide. */
export type SuggestHub = 'mcp' | 'builtin' | 'subagent' | 'skill' | 'knowledge';

export interface HubJudgedPick {
  id: string;
  confidence: number;
  reason: string;
}

export interface HubJudgement {
  picks: HubJudgedPick[];
  none: boolean;
  reason?: string;
}

/** Mid-confidence MCP / built-in integration offered as a one-click chip. */
export interface SuggestedIntegration {
  slug: string;
  label: string;
  confidence: number;
  readTools: string[];
  writeTools: string[];
}

export interface SuggestedPicks {
  integrations: SuggestedIntegration[];
  subagents: Array<{ name: string; confidence: number }>;
  skills: Array<{ slug: string; confidence: number }>;
  knowledge: Array<{ id: string; name: string; confidence: number }>;
}

/**
 * Response of POST /agents/suggest-tools. The legacy arrays (`subagents`,
 * `integrations`, `skillSlugs`, `knowledgeIds`) hold auto-bound picks only;
 * mid-confidence picks live under `suggested`. Every field added by the XOR
 * selector is optional so the judge / shortlist fallbacks keep working.
 */
export interface ToolSuggestion {
  subagents: string[];
  integrations: Array<{
    slug: string;
    readTools: string[];
    writeTools: string[];
  }>;
  reasoning: Record<string, string>;
  /** Optional org skill slugs the selector auto-bound. */
  skillSlugs?: string[];
  /** Auto-bound knowledge collection ids (match ids in the KB tree). */
  knowledgeIds?: string[];
  /** Per-hub output: `picks` is bound ∪ suggested. */
  hubs?: {
    mcp?: HubJudgement;
    builtin?: HubJudgement;
    subagent?: HubJudgement;
    skill?: HubJudgement;
    knowledge?: HubJudgement;
  };
  /** Mid-confidence picks to show as dashed "suggested" chips. */
  suggested?: SuggestedPicks;
  /** Max candidate probability per hub; present when the selector scored them. */
  needs?: Partial<Record<SuggestHub, number>>;
  /** How many write-intent questions scored high (0 = read-only job). */
  writes?: number;
  /** Which selector produced this response. */
  source?: 'xor' | 'judge' | 'shortlist';
  latencyMs?: number;
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
