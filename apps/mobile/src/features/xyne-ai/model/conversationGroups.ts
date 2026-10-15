import type { ConversationSummary } from '../api/xyneAIConversations';

export interface ConversationGroup {
  label: string;
  conversations: ConversationSummary[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Pinned chats first, the rest by the day of their last message; empty groups are dropped. */
export function groupConversations(
  conversations: ConversationSummary[],
  now = new Date(),
): ConversationGroup[] {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const groups = new Map<string, ConversationSummary[]>(
    ['Pinned', 'Today', 'Yesterday', 'Previous 7 days', 'Older'].map(label => [label, []]),
  );
  conversations.forEach(conversation => {
    const time = Date.parse(conversation.lastMessageAt);
    const label = conversation.pinned
      ? 'Pinned'
      : time >= startOfToday
        ? 'Today'
        : time >= startOfToday - DAY_MS
          ? 'Yesterday'
          : time >= startOfToday - 7 * DAY_MS
            ? 'Previous 7 days'
            : 'Older';
    groups.get(label)?.push(conversation);
  });
  return [...groups]
    .filter(([, grouped]) => grouped.length > 0)
    .map(([label, grouped]) => ({ label, conversations: grouped }));
}
