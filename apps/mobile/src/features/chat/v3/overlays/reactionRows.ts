import type { RawReaction } from '@/src/components/chat/message/reactions/reaction-pill.utils';

export type ReactionRow = {
  reactionId: string;
  userId: string;
  name: string;
  picture: string;
  emojiName: string;
  isSelf: boolean;
};

export const reactionRowsFor = (
  raw: readonly RawReaction[],
  resolve: (userId: string) => { name: string; picture: string } | undefined,
  currentUserId: string | undefined,
): ReactionRow[] =>
  [...raw]
    .sort((left, right) => left.createdAt - right.createdAt)
    .map(item => {
      const isSelf = Boolean(currentUserId) && item.userId === currentUserId;
      const user = resolve(item.userId);
      return {
        reactionId: item.reactionId,
        userId: item.userId,
        name: isSelf ? 'You' : (user?.name ?? 'Unknown'),
        picture: user?.picture ?? '',
        emojiName: item.emojiName,
        isSelf,
      };
    });
