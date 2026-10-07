import type { ActionDefinition } from './actions/action';
import { ADMINISTRATION_ACTIONS } from './actions/administration';
import { AGENT_ACTIONS } from './actions/agents';
import { ASSISTANT_ACTIONS } from './actions/assistant';
import { MESSAGING_ACTIONS } from './actions/messaging';

export const ACTIONS: readonly ActionDefinition[] = [
  ...ADMINISTRATION_ACTIONS,
  ...MESSAGING_ACTIONS,
  ...AGENT_ACTIONS,
  ...ASSISTANT_ACTIONS,
];
