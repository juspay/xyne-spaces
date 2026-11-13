// @xyne/workflow-sdk/agents/host — host-owned agent steps.
//
// A separate entry point from ./agents on purpose: everything reachable from
// here is free of pi-mono, so a host that runs its own agent platform (claw, an
// `agents` table, anything else behind a provider) does not pull
// @earendil-works/pi-agent-core, pi-ai and typebox into its bundle to get an
// agent step.
//
// Import from ./agents instead when you want the SDK to drive the LLM itself.

// ─── Provider Port ───

export { BaseAgentProvider, supportsSync, supportsAsync, resolveAgentMode } from './provider.js';
export type {
  AgentDescriptor,
  AgentDispatchRecord,
  AgentProvider,
  AgentRunEvent,
  AgentRunInput,
  AgentRunResult,
  AsyncAgentCapability,
  SyncAgentCapability,
} from './provider.js';

// ─── Step ───

export { HostAgentStep } from './host-agent-step.js';
export type { HostAgentBaseConfig, HostAgentStepOptions } from './host-agent-step.js';

// ─── Shared Agent Contract ───
//
// Exported so a provider can compose the same output shape and repair
// semantics the built-in steps use.

export {
  AgentResultSchema,
  agentContractFields,
  attachmentsField,
  jsonRepairRetriesField,
  classifyResponse,
  parseJsonResponse,
  resolveAgentOutputJsonSchema,
  shapeAgentResponse,
} from './contract.js';
export type { AgentResult, ResponseDefect, ToolCallRecord } from './contract.js';

// Citations the agent emits alongside its output (`output.response.citation`).
export type { CitationRef, CitationMap } from '../common/citation-ref.js';
export { CitationRefSchema, isCitationRef } from '../common/citation-ref.js';
