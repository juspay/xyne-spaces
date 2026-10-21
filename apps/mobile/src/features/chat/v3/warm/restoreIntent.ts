import type { PersistedChatWindowTarget } from '@/src/features/chat/navigation/restorePersistedChatWindow';

import { parseOpenIntent } from '../intent/parseOpenIntent';
import { err, type OpenIntent, type Result } from '../intent/openIntent.types';
import type { OpenFailure } from '../types/openFailure';

/**
 * Process-death restore (B13). `lastOpenChannel` only stores a channel id —
 * there is no persisted scroll offset — so the landing is a tail open unless
 * the caller already has a message identity.
 *
 * Does not import `lastOpenChannel.ts` (that module touches MMKV). Pass the
 * id from `readLastOpenChannelId()` at the route edge in Phase 9/10.
 */
export const restoreIntentFromLastOpen = (
  channelId: string | null,
  extra: Record<string, unknown> = {},
): Result<OpenIntent, OpenFailure> => {
  if (!channelId) {
    return err({ reason: 'invalid-intent', raw: { ...extra, source: 'restore' } });
  }
  return parseOpenIntent({
    ...extra,
    channelId,
    source: 'restore',
    isColdStart: true,
  });
};

export const persistedTargetForRestore = (
  channelId: string,
  over: { threadId?: string; messageId?: string; conversationId?: string } = {},
): PersistedChatWindowTarget => ({
  channelId,
  kind: over.threadId ? 'thread' : 'channel',
  ...(over.threadId ? { threadId: over.threadId } : {}),
  ...(over.messageId ? { messageId: over.messageId } : {}),
  ...(over.conversationId ? { conversationId: over.conversationId } : {}),
});

export const hydratePersistedWindowWith = (
  intent: OpenIntent,
  restore: (target: PersistedChatWindowTarget) => void,
): void => {
  const threadId = intent.surface.kind === 'channel' ? undefined : intent.surface.threadId;
  restore(
    persistedTargetForRestore(intent.surface.channelId, {
      ...(threadId ? { threadId } : {}),
      ...(intent.hint.messageId ? { messageId: intent.hint.messageId } : {}),
      ...(intent.hint.conversationId ? { conversationId: intent.hint.conversationId } : {}),
    }),
  );
};
