import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  GUARDRAIL_RE,
  MAX_SYSTEM_PROMPT_CHARS,
  MIN_SYSTEM_PROMPT_CHARS,
  validateSystemPromptContract,
  WORKFLOW_RE,
} from './agentPromptContract';

const SHARED_CONTRACT = fileURLToPath(
  new URL(
    '../../../../../../../../packages/xyne-claw-shared/src/agent-prompt-contract.ts',
    import.meta.url,
  ),
);

describe('agentPromptContract mirror', () => {
  it('matches the server contract in xyne-claw-shared', () => {
    const shared = readFileSync(SHARED_CONTRACT, 'utf8');
    expect(shared).toContain(WORKFLOW_RE.source);
    expect(shared).toContain(GUARDRAIL_RE.source);
    expect(shared).toContain(`MIN_SYSTEM_PROMPT_CHARS = ${MIN_SYSTEM_PROMPT_CHARS};`);
    expect(shared).toContain('MAX_SYSTEM_PROMPT_CHARS = 20_000;');
    expect(MAX_SYSTEM_PROMPT_CHARS).toBe(20_000);
  });

  it('accepts a prompt with a numbered workflow and guardrails', () => {
    const prompt = [
      'You are the morning brief agent.',
      '## Workflow',
      '1. Read unread DMs.',
      '2. Send a short brief.',
      '## Guardrails',
      '- Never send without asking first.',
    ].join('\n');
    expect(validateSystemPromptContract(prompt)).toEqual({ ok: true });
  });

  it('explains what is missing', () => {
    expect(validateSystemPromptContract('Be brief.').error).toMatch(/too short/);
    const noWorkflow =
      'You summarise tickets for the team every morning in a short list. Never post publicly.';
    expect(validateSystemPromptContract(noWorkflow).error).toMatch(/Workflow/);
    const noGuardrails =
      'You summarise tickets.\n1. Read tickets.\n2. Write a short list for the team.';
    expect(validateSystemPromptContract(noGuardrails).error).toMatch(/Guardrails/);
  });
});
