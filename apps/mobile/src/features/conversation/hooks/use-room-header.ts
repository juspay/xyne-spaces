import { useCallback } from 'react';

import { useConversationHeaderRoutes } from '@/src/components/chat/chat-header-v3/use-conversation-header-routes';
import { chatOpenProfiler } from '@/src/features/chat/chatOpenProfiler';
import { useConversationHeaderData } from '@/src/hooks/useConversationHeaderData';

import { roomKindOf, roomTitle, type RoomKind } from '../model/room-title';

type RoomHeaderModel = {
  isTitlePending: boolean;
  kind: RoomKind;
  title: string;
  /** "24 members" for a channel or group chat; none for a one-to-one chat. */
  subtitle: string | null;
  /** The other person in a one-to-one chat, for the small avatar. */
  dmUserId: string | null;
  isOnline: boolean;
  isPrivateChannel: boolean;
  onOpenInfo: () => void;
  onAskAI: () => void;
  onCall: () => void;
};

/**
 * What the room header shows and does. The data, call handler and the info and
 * Ask AI routes are the classic header's; search is find in this channel,
 * which `ChannelFindProvider` owns.
 */
export function useRoomHeader(channelId: string, enabled: boolean): RoomHeaderModel {
  chatOpenProfiler.count('chat_header_v3_render');
  const {
    channel,
    displayName,
    isTitlePending,
    isDM,
    isChannel,
    isPrivateChannel,
    dmProfileUserId,
    isOnline,
    memberCount,
    memberLabel,
    handleCallPress,
  } = useConversationHeaderData(channelId, { enabled });

  if (enabled) {
    chatOpenProfiler.count('chat_header_participants_query_render');
  }

  const kind = roomKindOf(channel?.scopeType);
  const { handleOpenInfo, handleAskAI } = useConversationHeaderRoutes(channelId, channel);

  const onCall = useCallback((): void => {
    void handleCallPress();
  }, [handleCallPress]);

  return {
    isTitlePending,
    kind,
    title: roomTitle(displayName, kind),
    subtitle: !isDM && memberCount > 0 ? `${memberCount} ${memberLabel}` : null,
    dmUserId: isDM ? dmProfileUserId : null,
    isOnline,
    isPrivateChannel: isChannel && isPrivateChannel,
    onOpenInfo: handleOpenInfo,
    onAskAI: handleAskAI,
    onCall,
  };
}
