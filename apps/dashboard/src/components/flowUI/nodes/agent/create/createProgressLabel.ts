/** Phase labels for the live create canvas build row (not model thoughts). */

import type { OrbState } from 'thinking-orbs';
import type { AgentCreateField, AgentCreateHubRow } from './types.ts';

export function progressLabelForField(
  field: AgentCreateField,
  _hubRow: AgentCreateHubRow | null = null,
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
      // Prefer truthful generic copy — preferred hub row can be subagent while
      // chips land on MCP (or multiple rows). Specificity comes from section acks.
      return 'Selecting tools on canvas…';
    case 'skills':
      return 'Selecting skills on canvas…';
    case 'knowledge':
      return 'Selecting knowledge on canvas…';
    case 'schedule':
      return 'Setting the schedule…';
    case 'properties':
      return 'Adding properties…';
    default:
      return 'Updating canvas…';
  }
}

/** Canvas pipeline status — not Ask AI model reasoning. */
export const PROGRESS_THINKING = 'Updating canvas…';

/** The draft's first step, before any field lands. */
export const PROGRESS_DRAFTING_NAME = 'Drafting name…';

/** The orb each field's write shows. A new field has to pick one here. */
const ORB_FOR_FIELD: Record<AgentCreateField, OrbState> = {
  name: 'composing',
  slug: 'composing',
  description: 'composing',
  systemPrompt: 'composing',
  tools: 'connecting',
  skills: 'connecting',
  knowledge: 'searching',
  permissionMode: 'weaving',
  schedule: 'weaving',
  properties: 'weaving',
};

const ORB_FOR_LABEL = new Map<string, OrbState>([
  ...(Object.keys(ORB_FOR_FIELD) as AgentCreateField[]).map((field): [string, OrbState] => [
    progressLabelForField(field),
    ORB_FOR_FIELD[field],
  ]),
  [PROGRESS_DRAFTING_NAME, 'composing'],
  [PROGRESS_THINKING, 'weaving'],
]);

/** Orb for a build-row label; anything else (the model thinking) is `working`. */
export function orbStateForProgress(label: string): OrbState {
  return ORB_FOR_LABEL.get(label) ?? 'working';
}
