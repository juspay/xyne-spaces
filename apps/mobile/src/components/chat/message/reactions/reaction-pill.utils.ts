/**
 * Aggregates raw message reactions for the bubble pill (WhatsApp-style summary).
 */

export type RawReaction = {
  createdAt: number;
  emojiName: string;
  messageId: string;
  reactionId: string;
  userId: string;
};

export type PillEmojiGroup = {
  emojiName: string;
  count: number;
  earliestTimestamp: number;
};

export function groupReactionsForPill(reactions: readonly RawReaction[]): PillEmojiGroup[] {
  const grouped = reactions.reduce<Record<string, PillEmojiGroup>>((acc, r) => {
    const emoji = r.emojiName;
    if (!acc[emoji]) {
      acc[emoji] = {
        emojiName: emoji,
        count: 0,
        earliestTimestamp: r.createdAt,
      };
    }
    acc[emoji].count += 1;
    if (r.createdAt < acc[emoji].earliestTimestamp) {
      acc[emoji].earliestTimestamp = r.createdAt;
    }
    return acc;
  }, {});

  return Object.values(grouped).sort((a, b) => a.earliestTimestamp - b.earliestTimestamp);
}

export function totalReactionCount(reactions: readonly RawReaction[]): number {
  return reactions.length;
}
