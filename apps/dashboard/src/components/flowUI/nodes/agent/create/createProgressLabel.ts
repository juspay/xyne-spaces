/** Phase labels for the live create canvas build row (not model thoughts). */

import type { CreateTurnField } from './classifyCreateTurn.ts';
import type { AgentCreateHubRow } from './types.ts';

export function progressLabelForField(
  field: CreateTurnField,
  hubRow: AgentCreateHubRow | null = null,
): string {
  switch (field) {
    case 'name':
      return 'Writing name on canvas…';
    case 'slug':
      return 'Writing handle on canvas…';
    case 'description':
      return 'Writing description on canvas…';
    case 'systemPrompt':
      return 'Writing instructions on canvas…';
    case 'tools':
      if (hubRow === 'builtin') return 'Selecting tools on canvas…';
      if (hubRow === 'subagent') return 'Selecting subagent on canvas…';
      return 'Selecting MCP on canvas…';
    case 'skills':
      return 'Selecting skills on canvas…';
    case 'knowledge':
      return 'Selecting knowledge on canvas…';
    default:
      return 'Updating canvas…';
  }
}

/** Canvas pipeline status — not Ask AI model reasoning. */
export const PROGRESS_THINKING = 'Updating canvas…';
