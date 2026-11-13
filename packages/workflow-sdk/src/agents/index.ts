// @xyne/workflow-sdk/agents — Agent / LLM system
//
// Separate entry point. Only usable when pi-mono peer deps are installed:
//   @earendil-works/pi-agent-core
//   @earendil-works/pi-ai

// ─── Types (re-exported from pi-mono + SDK-specific) ───

export type {
  // pi-mono re-exports
  AgentEvent,
  AgentSessionEvent,
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
  AgentContext,
  AgentMessage,
  AgentLoopConfig,
  BeforeToolCallResult,
  AfterToolCallResult,
  BeforeToolCallContext,
  AfterToolCallContext,
  ThinkingLevel,
  Message,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  TextContent,
  ThinkingContent,
  ImageContent,
  ToolCall,
  Tool,
  Usage,
  Model,
  Context,
  StopReason,
  TSchema,
  Static,
  // SDK-specific
  AgentCapabilities,
  AgentHooks,
  AgentInput,
  AgentPauseState,
  AgentResult,
  PauseRequest,
  PauseRequestType,
  ResumePayload,
  ResumeAttachment,
  ResumeAction,
  ToolCallRecord,
} from './types.js';

export { Type } from './types.js';

// ─── Base Runtime ───

export { BaseAgentRuntime } from './base-runtime.js';

// ─── Tool System ───

export type { WorkflowTool, ToolExecutionContext } from './tool-types.js';
export { AgentToolRegistry } from './tool-registry.js';
export { runCodeTool } from './builtin/run-code-tool.js';
export { createRunCodeAgentTool, createChatAgentTools } from './builtin/chat-tools.js';

// ─── Interceptors ───

export type { ToolInterceptor } from './interceptor.js';
export { runInterceptorChain } from './interceptor.js';
export { ApprovalGateInterceptor } from './interceptors/approval-gate.js';
export { ToolLoggingInterceptor } from './interceptors/tool-logger.js';

// ─── Agent Step ───

export {
  AgentStep,
  AgentStepConfigSchema,
  type AgentStepConfig,
} from './agent-step.js';

// Citations the agent emits alongside its output (`output.response.citation`).
export type { CitationRef, CitationMap } from '../common/citation-ref.js';
export { CitationRefSchema, isCitationRef } from '../common/citation-ref.js';

// ─── Host-Owned Agents ───
//
// For hosts that run their own agent platform rather than letting the SDK drive
// the LLM. Also available from the pi-free entry point `@xyne/workflow-sdk/agents/host`
// — import from there to keep pi-mono out of the bundle.

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

export { HostAgentStep } from './host-agent-step.js';
export type { HostAgentBaseConfig, HostAgentStepOptions } from './host-agent-step.js';

// ─── Shared Agent Contract ───

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
export type { ResponseDefect } from './contract.js';

// ─── Pi-Mono Runtime ───

export {
  PiMonoRuntime,
  PiMonoConfigSchema,
  type PiMonoConfig,
  type PiMonoRuntimeOptions,
} from './pi-mono-runtime.js';

// ─── Pi-Session Runtime (AgentSession-based) ───

export {
  PiSessionRuntime,
  PiSessionConfigSchema,
  type PiSessionConfig,
  type PiSessionRuntimeOptions,
} from './pi-session-runtime.js';
export type { AuthCredential } from '@earendil-works/pi-coding-agent';