/**
 * Shared system-prompt contract for agent authoring (propose-agent, Hub POST,
 * legacy create-agent). A draft must carry workflow + guardrails so created
 * agents are not one-liner personas.
 */

export const MIN_SYSTEM_PROMPT_CHARS = 40;
export const MAX_SYSTEM_PROMPT_CHARS = 20_000;

/** Permission modes stored on agent.config.permissionMode. */
export type AgentPermissionMode = "ask-first" | "read-only" | "can-write";

export const DEFAULT_PERMISSION_MODE: AgentPermissionMode = "ask-first";

const WORKFLOW_RE =
  /(?:^|\n)\s*(?:#{1,3}\s*)?(?:\d+\.\s*)?(?:operational\s+)?workflow\b|(?:^|\n)\s*(?:#{1,3}\s*)?when assigned\b|(?:^|\n)\s*(?:#{1,3}\s*)?procedure\b|(?:^|\n)\s*1\.\s+\S[\s\S]*\n\s*2\.\s+\S/i;

const GUARDRAIL_RE =
  /(?:^|\n)\s*(?:#{1,3}\s*)?guardrails?\b|(?:^|\n)\s*(?:#{1,3}\s*)?negative\s+constraints?\b|\bmust not\b|\bnever\b|\bdo not\b|\bdon't\b/i;

const CONTRASTIVE_RE =
  /(?:anti-?pattern|calibrated|robotic|contrastive|preferred\s+pattern)/i;

export interface SystemPromptContractResult {
  ok: boolean;
  error?: string;
}

/**
 * Reject thin or unstructured system prompts. Workflow + guardrails are
 * required; contrastive examples are recommended but not hard-rejected so
 * older drafts can still approve while authoring prompts catch up.
 */
export function validateSystemPromptContract(raw: string): SystemPromptContractResult {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text.length < MIN_SYSTEM_PROMPT_CHARS) {
    return {
      ok: false,
      error: `systemPrompt is too short (${text.length} chars). Write role, numbered workflow, tool usage, guardrails, and limits (min ${MIN_SYSTEM_PROMPT_CHARS}).`,
    };
  }
  if (text.length > MAX_SYSTEM_PROMPT_CHARS) {
    return {
      ok: false,
      error: `systemPrompt exceeds ${MAX_SYSTEM_PROMPT_CHARS} characters.`,
    };
  }
  if (!WORKFLOW_RE.test(text)) {
    return {
      ok: false,
      error:
        "systemPrompt must include a numbered Operational Workflow (steps 1, 2, …) or a section titled Workflow / Procedure.",
    };
  }
  if (!GUARDRAIL_RE.test(text)) {
    return {
      ok: false,
      error:
        "systemPrompt must include Guardrails / negative constraints (what the agent must never do).",
    };
  }
  return { ok: true };
}

export function normalizePermissionMode(raw: unknown): AgentPermissionMode {
  if (raw === "read-only" || raw === "can-write" || raw === "ask-first") return raw;
  return DEFAULT_PERMISSION_MODE;
}

export function permissionModeLabel(mode: AgentPermissionMode): string {
  switch (mode) {
    case "read-only":
      return "Read only";
    case "can-write":
      return "Can write";
    default:
      return "Ask first";
  }
}

/** Section headings the authoring prompts require, for docs and tests. */
export const SYSTEM_PROMPT_SECTION_HINTS = [
  "Identity & tone",
  "Operational Workflow",
  "When to use each tool",
  "Guardrails",
  "Decision rules",
  "Error recovery",
  "Contrastive examples",
] as const;
