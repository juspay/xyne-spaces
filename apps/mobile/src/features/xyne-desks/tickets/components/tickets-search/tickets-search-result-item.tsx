import { memo, useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import type { DisplaySearchResult } from '@/src/types/search';

import { TICKET_LIST_AVATAR_SIZE, TICKET_LIST_H_INSET } from '../../constants';
import { getTicketAvatarColor, getTicketAvatarInitial } from '../../utils';
import { getSmartSearchSnippet } from '../../utils/get-smart-search-snippet';
import { TicketsSearchHighlightedText } from './tickets-search-highlighted-text';

type TicketsSearchResultItemProps = {
  result: DisplaySearchResult;
  query: string;
  channelId: string;
  onNavigate?: () => void;
};

export const TicketsSearchResultItem = memo(function TicketsSearchResultItem({
  result,
  query,
  channelId,
  onNavigate,
}: TicketsSearchResultItemProps) {
  const router = useRouter();

  const senderName =
    result.searchContext?.senderName?.trim() || result.subtitle?.trim() || 'Unknown';
  const recipientCount = result.searchContext?.recipientCount ?? 0;

  const subject = result.title?.trim() || '(no subject)';
  const snippetRaw = result.context ? getSmartSearchSnippet(result.context, 40) : '';
  const timestamp = result.metadata.timestamp?.trim() || '';

  const initial = getTicketAvatarInitial(senderName);
  const avatarColor = getTicketAvatarColor(senderName || result.id);

  const handlePress = useCallback(() => {
    const ctx = result.searchContext;
    const targetChannelId = ctx?.channelId || channelId;
    const xyneId = ctx?.xyneId;
    if (!targetChannelId || !xyneId) return;

    const params = new URLSearchParams();
    if (ctx?.ticketId) params.set('id', ctx.ticketId);
    if (ctx?.mailId) params.set('mail', ctx.mailId);

    const qs = params.toString();
    onNavigate?.();
    router.push(`/xyne-desks/${targetChannelId}/${xyneId}${qs ? `?${qs}` : ''}`);
  }, [result.searchContext, channelId, onNavigate, router]);

  return (
    <View style={{ paddingHorizontal: TICKET_LIST_H_INSET }} className='mb-0.5'>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={`Open ticket ${result.searchContext?.xyneId || subject}`}
        onPress={handlePress}
        className='flex-row gap-3 rounded-xl bg-card px-3 py-2.5 active:bg-foreground/5'
      >
        <View
          className='items-center justify-center rounded-full'
          style={{
            width: TICKET_LIST_AVATAR_SIZE,
            height: TICKET_LIST_AVATAR_SIZE,
            backgroundColor: avatarColor,
          }}
        >
          <Text className='text-[15px] font-semibold text-white'>{initial}</Text>
        </View>

        <View className='min-w-0 flex-1'>
          <View className='flex-row items-center gap-2'>
            <Text
              className='min-w-0 flex-1 text-[15px] font-medium text-foreground'
              numberOfLines={1}
            >
              <TicketsSearchHighlightedText
                value={senderName}
                query={query}
                className='text-[15px] font-medium text-foreground'
              />
              {recipientCount > 0 ? (
                <Text className='text-[15px] font-medium text-foreground/70'>
                  {` +${recipientCount} more`}
                </Text>
              ) : null}
            </Text>
            {timestamp ? (
              <Text className='shrink-0 text-[12px] font-medium text-foreground/80'>
                {timestamp}
              </Text>
            ) : null}
          </View>

          <TicketsSearchHighlightedText
            value={subject}
            query={query}
            className='mt-0.5 text-[14px] font-semibold text-foreground'
            numberOfLines={1}
          />

          {snippetRaw ? (
            <TicketsSearchHighlightedText
              value={snippetRaw}
              query={query}
              className='mt-0.5 text-[13px] text-foreground/70'
              numberOfLines={2}
            />
          ) : null}
        </View>
      </Pressable>
    </View>
  );
});
