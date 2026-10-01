/**
 * Agent system-prompt contract — dashboard mirror.
 *
 * Kept in step BY HAND with packages/xyne-claw-shared/src/agent-prompt-contract.ts,
 * which claw-auth runs on POST /agents. Checking here lets the create canvas
 * explain a blocked Save instead of failing with a 400 after the click.
 * agentPromptContract.test.ts fails when the two drift.
 *
 * The dashboard deliberately does not depend on xyne-claw-shared (see
 * ReactArtifact/artifactData.constants.ts for the same pattern).
 */

export const MIN_SYSTEM_PROMPT_CHARS = 40;
export const MAX_SYSTEM_PROMPT_CHARS = 20_000;

export type AgentPermissionMode = 'ask-first' | 'read-only' | 'can-write';

export const DEFAULT_PERMISSION_MODE: AgentPermissionMode = 'ask-first';

export const WORKFLOW_RE =
  /(?:^|\n)\s*(?:#{1,3}\s*)?(?:\d+\.\s*)?(?:operational\s+)?workflow\b|(?:^|\n)\s*(?:#{1,3}\s*)?when assigned\b|(?:^|\n)\s*(?:#{1,3}\s*)?procedure\b|(?:^|\n)\s*1\.\s+\S[\s\S]*\n\s*2\.\s+\S/i;

export const GUARDRAIL_RE =
  /(?:^|\n)\s*(?:#{1,3}\s*)?guardrails?\b|(?:^|\n)\s*(?:#{1,3}\s*)?negative\s+constraints?\b|\bmust not\b|\bnever\b|\bdo not\b|\bdon't\b/i;

export interface SystemPromptContractResult {
  ok: boolean;
  error?: string;
}

/** Same checks and order as the server. Error copy is written for the canvas. */
export function validateSystemPromptContract(raw: string): SystemPromptContractResult {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text.length < MIN_SYSTEM_PROMPT_CHARS) {
    return {
      ok: false,
      error: `Instructions are too short. Add a role, numbered workflow and guardrails (at least ${MIN_SYSTEM_PROMPT_CHARS} characters).`,
    };
  }
  if (text.length > MAX_SYSTEM_PROMPT_CHARS) {
    return {
      ok: false,
      error: `Instructions are longer than ${MAX_SYSTEM_PROMPT_CHARS.toLocaleString()} characters.`,
    };
  }
  if (!WORKFLOW_RE.test(text)) {
    return {
      ok: false,
      error: 'Instructions need a Workflow section with numbered steps (1., 2., …).',
    };
  }
  if (!GUARDRAIL_RE.test(text)) {
    return {
      ok: false,
      error: 'Instructions need a Guardrails section saying what the agent must never do.',
    };
  }
  return { ok: true };
}

export function normalizePermissionMode(raw: unknown): AgentPermissionMode {
  if (raw === 'read-only' || raw === 'can-write' || raw === 'ask-first') return raw;
  return DEFAULT_PERMISSION_MODE;
}
