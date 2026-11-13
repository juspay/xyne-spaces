import type { WorkflowConfig } from '../types/workflow-config.js';

export type { WorkflowConfig };

export interface AiBuilderToolCall {
  name: string;
  isError?: boolean;
}

export interface AiBuilderMessage {
  role: 'user' | 'assistant';
  content: string;
  tools?: AiBuilderToolCall[];
}


export interface ChatStreamHandlers {
  onText?: (text: string) => void;
  onTool?: (tool: { id: string; name: string; status: 'start' | 'end'; isError?: boolean }) => void;
  onFormFill?: (formFill: Record<string, unknown>) => void;
  onPatch?: (workflowPatch: WorkflowConfig) => void;
  /** Final cleaned message; the turn is complete. */
  onDone?: (message: string) => void;
  onError?: (error: string) => void;
}

/** Builder mode — sends workflow config, may receive a patch. */
export interface BuilderChatRequest {
  messages: AiBuilderMessage[];
  mode?: 'builder';
  currentConfig: WorkflowConfig;
}

/** Approval mode — identifies the execution, may receive form fill. */
export interface ApprovalChatRequest {
  messages: AiBuilderMessage[];
  mode: 'approval';
  executionId: string;
  /** Live form values at the moment the message was sent. */
  currentFormValues?: Record<string, unknown>;
}

export type AiBuilderChatRequest = BuilderChatRequest | ApprovalChatRequest;

export interface BuilderChatResponse {
  message: string;
  workflowPatch?: WorkflowConfig;
}

export interface ApprovalChatResponse {
  message: string;
  formFill?: Record<string, unknown>;
}

export type AiBuilderResponse = BuilderChatResponse | ApprovalChatResponse;
