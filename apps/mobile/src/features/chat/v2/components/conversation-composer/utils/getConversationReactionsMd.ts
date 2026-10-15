import { parseInitialMessageMd } from '@xyne/shared';

import type { ConversationItem } from '../conversation-composer.types';

export const getConversationReactionsMd = (
  conversation: ConversationItem | null | undefined,
): string | null => {
  const summaryReactionsMd = parseInitialMessageMd(conversation?.initial_message_md)?.reactions_md;
  if (typeof summaryReactionsMd === 'string') return summaryReactionsMd;

  const reactionsMd =
    conversation && typeof conversation === 'object'
      ? (conversation as Record<string, unknown>)['reactions_md']
      : null;
  return typeof reactionsMd === 'string' ? reactionsMd : null;
};
