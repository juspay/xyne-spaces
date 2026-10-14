import { restorePersistedChatWindow } from '@/src/features/chat/navigation/restorePersistedChatWindow';

import type { OpenIntent } from '../intent/openIntent.types';
import { hydratePersistedWindowWith } from './restoreIntent';

/** Seeds the in-memory query cache from disk before the live subscribe.
 *  Idempotent — React may run the `useState` initializer twice. */
export const hydratePersistedWindow = (intent: OpenIntent): void =>
  hydratePersistedWindowWith(intent, restorePersistedChatWindow);
