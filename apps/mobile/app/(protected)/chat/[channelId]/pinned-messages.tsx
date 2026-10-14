import { LegendList } from '@legendapp/list/react-native';
import { useLocalSearchParams } from 'expo-router';
import { Pin } from 'lucide-react-native';
import { ReactElement, useMemo } from 'react';
import { Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { DatePill, formatDatePill } from '@/src/components/chat/date-pill';
import { PinnedMessagesHeaderV3 } from '@/src/components/chat/pinned-messages-header-v3';
import { ChatUserProfileActionsSheetProvider } from '@/src/features/chat/v2/components/chat/chat-user-profile-actions-sheet';
import { useChatRenderTokens } from '@/src/theme/useChatRenderTokens';
import { ChatRenderProvider } from '@/src/features/chat/v2/components/chat/message-row';
import {
  ChatComposer,
  ConversationSkeleton,
  type ConversationItem,
} from '@/src/features/chat/v2/components/conversation-composer';
import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { useGetChannelUserStatus } from '@/src/hooks/useChannels';
import { useSelf } from '@/src/hooks/useUsers';
import { queries } from '@/src/zero/queries';

const HEADER_RESERVED_HEIGHT = 44 + 16;

type PinnedRow = {
  id: string;
  item: ConversationItem;
};

type PinnedListRow =
  | {
      type: 'date';
      id: string;
      date: number;
    }
  | {
      type: 'message';
      id: string;
      item: ConversationItem;
    };

const getDateKey = (timestamp: number): string => new Date(timestamp).toDateString();

const PinnedMessagesScreen = (): ReactElement => {
  const { channelId } = useLocalSearchParams<{ channelId: string }>();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  // Same theme-aware token bundle the main conversation list feeds into
  // `ChatRenderProvider`. Without it the shared bubble primitives fall back to
  // hardcoded light-mode colors, which is what broke pinned messages in dark mode.
  const chatRenderTokens = useChatRenderTokens(windowWidth);
  const userChannelStatus = useGetChannelUserStatus(channelId ?? '');
  const currentUser = useSelf();

  const [pinned, details] = useCachedQuery(
    queries.getPinnedMessegesV2({
      channelId: channelId ?? '',
      isMember: !!userChannelStatus,
    }),
  );

  const isLoading = details.type === 'unknown';

  const rows = useMemo<PinnedListRow[]>(() => {
    if (!pinned) return [];

    const messageRows: PinnedRow[] = pinned
      .map(conv => {
        // Bridge the pinned query shape (`initialMessage.attachments`) to the shape
        // the conversation-composer expects (`initialMessageAttachments`).
        const adapted = {
          ...conv,
          initialMessageAttachments: conv.initialMessage?.attachments ?? [],
        } as unknown as ConversationItem;
        return { id: conv.conversationId, item: adapted };
      })
      .sort((a, b) => b.item.createdAt - a.item.createdAt);

    const nextRows: PinnedListRow[] = [];
    let previousDateKey: string | null = null;

    for (const row of messageRows) {
      const dateKey = getDateKey(row.item.createdAt);
      if (dateKey !== previousDateKey) {
        nextRows.push({
          type: 'date',
          id: `date-${dateKey}`,
          date: row.item.createdAt,
        });
        previousDateKey = dateKey;
      }
      nextRows.push({ type: 'message', id: row.id, item: row.item });
    }

    return nextRows;
  }, [pinned]);

  const renderItem = ({ item }: { item: PinnedListRow }): ReactElement => {
    if (item.type === 'date') {
      return <DatePill dateText={formatDatePill(item.date)} />;
    }

    // Render pinned messages with the exact same bubble the main conversation
    // uses so styling and theming stay in lockstep across both surfaces.
    return <ChatComposer conversation={item.item} currentUser={currentUser} />;
  };

  const listPaddingTop = insets.top + HEADER_RESERVED_HEIGHT;
  const hasContent = isLoading || rows.length > 0;

  return (
    <View className='flex-1 bg-chat-screen'>
      <PinnedMessagesHeaderV3 channelId={channelId ?? ''} />

      <ChatUserProfileActionsSheetProvider>
        <ChatRenderProvider value={chatRenderTokens}>
          {hasContent ? (
            <View className='flex-1'>
              {isLoading ? (
                <View className='flex-1 px-4' style={{ paddingTop: listPaddingTop }}>
                  <ConversationSkeleton />
                </View>
              ) : (
                <LegendList
                  data={rows}
                  keyExtractor={row => row.id}
                  renderItem={renderItem}
                  contentContainerStyle={{
                    paddingTop: listPaddingTop,
                    paddingHorizontal: 16,
                    paddingBottom: insets.bottom + 16,
                  }}
                  estimatedItemSize={120}
                  showsVerticalScrollIndicator={false}
                />
              )}
            </View>
          ) : (
            <View
              className='flex-1 items-center justify-center px-8'
              style={{ paddingTop: listPaddingTop }}
            >
              <Pin size={48} color={foregroundColor} opacity={0.7} />
              <Text className='mt-4 text-center text-secondary-foreground'>
                No pinned messages yet
              </Text>
              <Text className='mt-1 text-center text-sm text-secondary-foreground'>
                Pin important messages to find them quickly
              </Text>
            </View>
          )}
        </ChatRenderProvider>
      </ChatUserProfileActionsSheetProvider>
    </View>
  );
};

export default PinnedMessagesScreen;
