import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../../zero/queries';
import { useMemo } from 'react';
import { CombinedMessageItem } from './ChatListUtils';

type CombinedMesseges = {
  combinedMessages: CombinedMessageItem[];
  dateGroups: string[];
  groupCounts: number[];
};

type InputProps = QueryResultType<typeof queries.channelConversationsPaginated>;

export const useCombinedMesseges = (conversations: InputProps): CombinedMesseges => {
  const combinedMessages: CombinedMessageItem[] = useMemo(() => {
    return conversations.map(conversation => ({
      type: 'conversation' as const,
      data: conversation,
      createdAt: new Date(conversation.createdAt),
    }));
  }, [conversations]);

  const { groupCounts, dateGroups } = useMemo((): {
    groupCounts: number[];
    dateGroups: string[];
  } => {
    if (combinedMessages.length === 0) {
      return { groupCounts: [], dateGroups: [] };
    }

    const groups = new Map<string, CombinedMessageItem[]>();

    combinedMessages.forEach(msg => {
      const dateKey = msg.createdAt.toDateString();
      if (!groups.has(dateKey)) {
        groups.set(dateKey, []);
      }
      groups.get(dateKey)!.push(msg);
    });

    const dateGroups = Array.from(groups.keys());
    const groupCounts = dateGroups.map(date => groups.get(date)!.length);

    return { groupCounts, dateGroups };
  }, [combinedMessages]);

  return {
    groupCounts,
    dateGroups,
    combinedMessages,
  };
};
