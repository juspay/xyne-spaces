/**
 * Agent / LLM system types for the workflow SDK.
 *
 * Uses `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` as the
 * base type system. This module re-exports the pi-mono types we use and
 * defines SDK-specific types that augment them (pause protocol, capabilities,
 * result shape, etc.).
 *
 * Only usable when pi-mono peer dependencies are installed.
 */

import type { ToolCallRecord } from './contract.js';

// ─── Re-exports from pi-mono ───

export type {
  AgentEvent,
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
} from '@earendil-works/pi-agent-core';

export type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

export type {
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
} from '@earendil-works/pi-ai';

export type { TSchema, Static } from 'typebox';
export { Type } from 'typebox';

// ─── Agent Capabilities ───

/** What capabilities a runtime implementation supports. */
export interface AgentCapabilities {
  /** Can yield token-level streaming events. */
  streaming: boolean;
  /** Can call tools. */
  toolUse: boolean;
  /** Supports beforeToolCall/afterToolCall hooks. */
  hooks: boolean;
  /** Can maintain conversation across multiple turns. */
  multiTurn: boolean;
}

// ─── Agent Hooks (SDK-level) ───

/**
 * Hooks injected into the runtime by AgentStep.
 * Mapped from the interceptor chain.
 */
export interface AgentHooks {
  beforeToolCall?(
    tool: string,
    args: Record<string, unknown>,
  ): Promise<'allow' | 'deny' | 'pause'>;
  afterToolCall?(
    tool: string,
    args: Record<string, unknown>,
    result: unknown,
  ): Promise<void>;
}

// ─── Pause / Resume Protocol ───

export type PauseRequestType =
  | 'tool_approval'
  | 'input_required'
  | 'user_interrupted'
  | 'awaiting_feedback';

/** Built by AgentStep when the agent needs to pause. */
export interface PauseRequest {
  type: PauseRequestType;
  reason: string;
  prompt: string;
  /** Present for tool_approval pauses. */
  tool?: { name: string; args: Record<string, unknown> };
  /** Agent state to persist across the pause boundary. */
  state: AgentPauseState;
}

// ResumePayload + ResumeAttachment live in the core types module so the
// executor, runtime, router, and persistence layer can use them without
// pulling in agent-specific code. Re-exported here for convenience.
export type {
  ResumePayload,
  ResumeAttachment,
  ResumeAction,
} from '../common/resume-payload.js';

// ─── Agent Input ───

/** Input to BaseAgentRuntime.execute(). */
export interface AgentInput {
  tools: import('@earendil-works/pi-agent-core').AgentTool[];
  hooks: AgentHooks;
  signal: AbortSignal;
  /** Present when resuming from a pause. */
  resume?: {
    messages: import('@earendil-works/pi-agent-core').AgentMessage[];
    payload: import('../common/resume-payload.js').ResumePayload;
    pauseState: PauseRequest;
  };
}

// ─── Agent Pause State ───

/** What the agent step persists across pause boundaries. */
export interface AgentPauseState {
  messages: import('@earendil-works/pi-agent-core').AgentMessage[];
  pendingToolCalls?: import('@earendil-works/pi-ai').ToolCall[];
  completedToolCallResults?: import('@earendil-works/pi-ai').ToolResultMessage[];
  pausedAtToolIndex?: number;
  currentTurn: number;
  completedToolCalls: ToolCallRecord[];
  usage: { inputTokens: number; outputTokens: number };
}

// ToolCallRecord + AgentResult live in ./contract.ts — they are part of the
// agent *contract*, shared with host-backed agent steps that never load
// pi-mono. Re-exported here so existing imports keep working.
export type { ToolCallRecord, AgentResult } from './contract.js';

