/** Phase labels for the live create working/reasoning row (not chat bubbles). */

import type { CreateTurnField } from './classifyCreateTurn.ts';
import type { AgentCreateHubRow } from './types.ts';

export function progressLabelForField(
  field: CreateTurnField,
  hubRow: AgentCreateHubRow | null = null,
): string {
  switch (field) {
    case 'name':
      return 'Drafting name…';
    case 'slug':
      return 'Drafting handle…';
    case 'description':
      return 'Writing description…';
    case 'systemPrompt':
      return 'Drafting instructions…';
    case 'tools':
      if (hubRow === 'builtin') return 'Suggesting tools…';
      if (hubRow === 'subagent') return 'Suggesting subagent…';
      return 'Picking MCP…';
    case 'skills':
      return 'Suggesting skills…';
    case 'knowledge':
      return 'Suggesting knowledge…';
    default:
      return 'Working…';
  }
}

export const PROGRESS_THINKING = 'Thinking…';
