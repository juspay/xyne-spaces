/**
 * Shared tool definition types used by both xyne-claw-auth (for DB seeding)
 * and xyne-claw (for execution).
 */

import type { Citation } from "../types/citation.js";
import type { UiWidget, UserQuestion } from "../types/ui-widget.js";

export type { UiWidget, UserQuestion, UserQuestionType } from "../types/ui-widget.js";

export interface ToolInputSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  oneOf?: Array<Record<string, unknown>>;
}

export interface ConfigField {
  label: string;
  default: string;
  required: boolean;
  placeholder?: string;
}

export interface PendingQuestion {
  questionId: string;
  questions?: UserQuestion[];
  /** Legacy follow-up suggestion chips still use this compact shape. */
  question?: string;
  options?: string[];
  purpose?: "clarification" | "follow_up_suggestions";
}

export interface PendingResponse {
  responseId: string;
  message: string;
}

export interface ToolExecutionContext {
  config: Record<string, string>;
  meta?: Record<string, string>;
  /**
   * The run's resolved LLM provider. Tools that make their OWN LLM call
   * (e.g. create-ppt's slide-JSON generation) read this so they inherit the
   * agent's configured model/key instead of a hardcoded fallback. Populated by
   * xyne-claw's run dispatcher with the copilot proxy + base-URL defaulting
   * already applied. Absent when the run has no bring-your-own provider — tools
   * then fall back to the shared LiteLLM config.
   */
  providerConfig?: {
    provider: string;
    baseUrl?: string;
    apiKey: string;
    model: string;
    authType?: string;
  };
  pendingQuestions?: PendingQuestion[];
  pendingResponses?: PendingResponse[];
  /** Progress URL for streaming tool invocations to the frontend (claw agent only) */
  progressUrl?: string;
  /**
   * Publish typed widget data through whichever transport this run uses.
   * The runtime owns HTTP-vs-SSE selection; tools must not depend on it.
   */
  emitUiWidget?: (widget: UiWidget) => Promise<void>;
  /** Session ID for this agent run (claw agent only) */
  sessionId?: string;
  /** S2S key for authenticating with the progress endpoint (claw agent only) */
  s2sKey?: string;
  /**
   * Per-run HMAC bearer token for authenticating with claw-auth's
   * /sessions/:sessionId/mcp/* endpoints. Minted by claw-auth at /run
   * dispatch time and forwarded into the run context. Required by any tool
   * that calls claw-auth's MCP route directly. Other tools
   * call MCP via xyne-claw's mcp.ts wrapper which threads this through
   * internally — they don't need to read it from the context.
   */
  sessionToken?: string;
  /** The tool call ID assigned by the claw framework for this tool execution */
  toolCallId?: string;
  /**
   * Terminate the in-flight agent run immediately. Used by terminal tools
   * (e.g. respond-to-user) that must guarantee the loop stops, regardless of
   * whether the underlying LLM honors a "STOP" tool result. Wired in claw's
   * run dispatcher to AbortController.abort().
   */
  abortRun?: () => void;
}

export interface ToolDefinition {
  /** Unique slug, e.g. "sandbox-run-command" */
  slug: string;
  /** Display name */
  name: string;
  /** What the tool does */
  description: string;
  /** Where it runs: "custom:sandbox", "mcp:xyne-spaces", "builtin" */
  source: string;
  /** JSON Schema for parameters */
  inputSchema: ToolInputSchema;
  /** Config keys this tool needs, with defaults */
  configSchema?: Record<string, ConfigField>;
  /** Mark as write tool — always requires user approval before execution */
  isWriteTool?: boolean;
  /** The actual implementation — runs inside xyne-claw */
  execute: (params: Record<string, unknown>, context?: ToolExecutionContext) => Promise<string>;
  /**
   * Optional citation-aware variant. When present, MCP server wrappers (e.g.
   * google-server) call THIS instead of `execute` to obtain `{ text, citations }`
   * and attach the citations as MCP `_meta.citations`. `execute` stays the
   * string-only contract used by in-process custom-tools and other wrappers, so
   * tools that implement both keep `execute` returning just the text.
   */
  executeCited?: (
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ) => Promise<{ text: string; citations?: Citation[] }>;
}
