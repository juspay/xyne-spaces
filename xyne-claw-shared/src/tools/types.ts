/**
 * Shared tool definition types used by both xyne-claw-auth (for DB seeding)
 * and xyne-claw (for execution).
 */

export interface ToolInputSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

export interface ConfigField {
  label: string;
  default: string;
  required: boolean;
  placeholder?: string;
}

export interface PendingQuestion {
  questionId: string;
  question: string;
  options: string[];
}

export interface PendingResponse {
  responseId: string;
  message: string;
}

export interface ToolExecutionContext {
  config: Record<string, string>;
  meta?: Record<string, string>;
  pendingQuestions?: PendingQuestion[];
  pendingResponses?: PendingResponse[];
}

export interface ToolDefinition {
  /** Unique slug, e.g. "pgm-list-programs" */
  slug: string;
  /** Display name */
  name: string;
  /** What the tool does */
  description: string;
  /** Where it runs: "custom:pgm", "mcp:xyne-spaces", "builtin" */
  source: string;
  /** JSON Schema for parameters */
  inputSchema: ToolInputSchema;
  /** Config keys this tool needs, with defaults */
  configSchema?: Record<string, ConfigField>;
  /** Mark as write tool — always requires user approval before execution */
  isWriteTool?: boolean;
  /** The actual implementation — runs inside xyne-claw */
  execute: (params: Record<string, unknown>, context?: ToolExecutionContext) => Promise<string>;
}
