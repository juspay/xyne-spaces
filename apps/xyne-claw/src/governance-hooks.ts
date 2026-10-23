/**
 * Governance extension points for claw. The implementation is private: it lives under src/extensions/
 * (loaded by extension.ts) and registers itself here when it loads. Without it a run gets no hooks,
 * answers pass through untouched, no decision travels with an MCP call and no kill switch exists.
 */
import type { AfterToolCallContext, AfterToolCallResult, BeforeToolCallContext, BeforeToolCallResult } from "@earendil-works/pi-agent-core";

export interface ToolMetaEntry {
  name: string;
  serverType?: string | undefined;
  mcpToolName?: string | undefined;
  isWriteTool?: boolean | undefined;
  /** Under the server's declared write policy: true a write, false a read; absent when nothing was declared. */
  declaredWrite?: boolean | undefined;
  /** The server's description of the tool; its opening verb classifies a name that has none. */
  description?: string | undefined;
  permission?: string | undefined;
}

/** Reads the fields claw's MCP loader stamps on a tool definition; a local tool has none. */
export function toolMetaOf(tool: { name: string } & Record<string, unknown>): ToolMetaEntry {
  const key = typeof tool["serverToolKey"] === "string" ? tool["serverToolKey"] : undefined;
  const serverType = key?.split("__")[0];
  return {
    name: tool.name,
    ...(serverType ? { serverType } : {}),
    ...(typeof tool["mcpToolName"] === "string" ? { mcpToolName: tool["mcpToolName"] } : {}),
    ...(typeof tool["isWriteTool"] === "boolean" ? { isWriteTool: tool["isWriteTool"] } : {}),
    ...(typeof tool["declaredWrite"] === "boolean" ? { declaredWrite: tool["declaredWrite"] } : {}),
    ...(serverType && typeof tool["description"] === "string" && tool["description"] ? { description: tool["description"] } : {}),
  };
}

export interface GovernedAgent {
  streamFn?: unknown;
  beforeToolCall?: ((context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>) | undefined;
  afterToolCall?: ((context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>) | undefined;
}

export interface RunGovernanceHandle {
  /** D: the answer before it leaves the run; the text comes back unchanged unless a check enforces. */
  inspectAnswer(text: string): { text: string };
  finish(): Promise<void>;
}

export interface RunGovernanceOptions {
  sessionId: string;
  userId: string;
  orgId?: string | undefined;
  conversationId?: string | undefined;
  agentSlug?: string | undefined;
  channel?: string | undefined;
  /** Every custom tool the session holds, so the gate can tell an MCP tool from a local one. */
  toolMeta?: readonly ToolMetaEntry[] | undefined;
  /** "parent" registers the run for D; a subagent shares its parent's conversation state. */
  role?: "parent" | "subagent" | undefined;
  parent?: RunGovernanceHandle | undefined;
  /** The registry versions this run loaded, listed in its start event. */
  loaded?: readonly { versionId: string; sha256: string; slug: string }[] | undefined;
  /** The run's request and whether a person typed it. */
  request?: { text: string; typedByPerson: boolean } | undefined;
}

export interface KillableRun {
  sessionId: string;
  userId: string;
  agentSlug?: string | undefined;
  orgId?: string | undefined;
  abort: (reason: string) => void;
}

export interface ClawGovernanceHooks {
  /** Installs the run's hooks on the pi agent (installed last, so they wrap every other hook) and returns its handle. */
  installRun(agent: GovernedAgent, opts: RunGovernanceOptions): RunGovernanceHandle;
  governanceForRun(sessionId: string): RunGovernanceHandle | undefined;
  /** The gate's decision for a tool call, sent along with the MCP call so claw-auth verifies instead of deciding again. */
  decisionFor(toolCallId: string): Record<string, unknown> | undefined;
  registerRunOrg(sessionId: string, orgId: string): void;
  /** The runs this pod owns, so a stop switch can abort the ones it matches. */
  registerKillableRuns(list: (() => KillableRun[]) | null): void;
}

const idle: RunGovernanceHandle = { inspectAnswer: (text) => ({ text }), finish: async () => undefined };
let killableRuns: (() => KillableRun[]) | null = null;

export const governance: ClawGovernanceHooks = {
  installRun: () => idle,
  governanceForRun: () => undefined,
  decisionFor: () => undefined,
  registerRunOrg: () => undefined,
  // Kept until the implementation loads: the run router registers at import time, which may precede it.
  registerKillableRuns: (list) => { killableRuns = list; },
};

/** The private implementation calls this once when it loads. */
export function registerGovernanceHooks(impl: Partial<ClawGovernanceHooks>): void {
  Object.assign(governance, impl);
  if (impl.registerKillableRuns && killableRuns) impl.registerKillableRuns(killableRuns);
}
