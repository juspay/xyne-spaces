/**
 * §8.1 reuse gate: **Refactor-then-adopt**. Characterised against v2
 * getConversationReactionsMd. Drops the v2 ConversationItem/Zero type in
 * favour of the fields the function actually reads.
 */
import { parseInitialMessageMd } from '@xyne/shared';

export type ReactionsSource = {
  initialMessageMd?: string | null;
  reactionsMd?: string | null;
};

export const getConversationReactionsMd = (
  conversation: ReactionsSource | null | undefined,
): string | null => {
  const summaryReactionsMd = parseInitialMessageMd(conversation?.initialMessageMd)?.reactions_md;
  if (typeof summaryReactionsMd === 'string') return summaryReactionsMd;
  const reactionsMd = conversation?.reactionsMd;
  return typeof reactionsMd === 'string' ? reactionsMd : null;
};
