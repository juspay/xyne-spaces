import { ADMINISTRATION } from './actions/administration';
import { AGENTS } from './actions/agents';
import { MESSAGING } from './actions/messaging';

export const AREAS = [ADMINISTRATION, MESSAGING, AGENTS] as const;
