import { type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, ChevronLeft, Phone, Search, Sparkles } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import {
  ConversationHeaderIcon,
  HeaderPresenceDot,
} from '@/src/components/chat/conversation-header-icon';
import { ConversationHeaderTitleSkeleton } from '@/src/components/chat/conversation-header-title-skeleton';
import { ReactionEmojiDisplay } from '@/src/components/chat/message/reactions/reaction-emoji-display';
import { AvatarFace } from '@/src/ui/avatar';

import {
  ROOM_HEADER_AVATAR_SIZE,
  ROOM_HEADER_BUTTON_ICON_SIZE,
  ROOM_HEADER_BUTTON_SIZE,
  ROOM_HEADER_CHEVRON_SIZE,
  ROOM_HEADER_HEIGHT,
  ROOM_HEADER_PADDING_LEFT,
  ROOM_HEADER_PADDING_RIGHT,
  ROOM_HEADER_TITLE_GAP,
} from '../constants';
import { useRoomHeader } from '../hooks/use-room-header';
import { HeaderButton } from './header-button';

type RoomHeaderProps = {
  channelId: string;
  postPaintReady: boolean;
  onBack: () => void;
};

export function RoomHeader({ channelId, postPaintReady, onBack }: RoomHeaderProps): ReactElement {
  const insets = useSafeAreaInsets();
  const foreground = useCSSVariable('--color-spaces-foreground') as string;
  const header = useRoomHeader(channelId, postPaintReady);

  return (
    <View className='bg-spaces-background' style={{ paddingTop: insets.top }}>
      <View
        className='flex-row items-center'
        style={{
          height: ROOM_HEADER_HEIGHT,
          paddingLeft: ROOM_HEADER_PADDING_LEFT,
          paddingRight: ROOM_HEADER_PADDING_RIGHT,
        }}
      >
        <HeaderButton label='Back' size={ROOM_HEADER_BUTTON_SIZE} onPress={onBack}>
          <ChevronLeft size={ROOM_HEADER_BUTTON_ICON_SIZE} color={foreground} />
        </HeaderButton>

        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Conversation info'
          onPress={header.onOpenInfo}
          className='min-w-0 flex-1 flex-row items-center active:opacity-60'
          style={{ paddingLeft: ROOM_HEADER_TITLE_GAP, columnGap: 8 }}
        >
          {header.isTitlePending ? (
            <ConversationHeaderTitleSkeleton />
          ) : (
            <>
              {header.dmUserId ? (
                <View className='relative'>
                  <AvatarFace userId={header.dmUserId} size={ROOM_HEADER_AVATAR_SIZE} />
                  <HeaderPresenceDot isOnline={header.isOnline} />
                </View>
              ) : null}
              {header.isPrivateChannel ? (
                <ConversationHeaderIcon
                  isDM={false}
                  isChannel
                  isPrivateChannel
                  dmProfileUserId={null}
                  isOnline={false}
                />
              ) : null}
              <View className='min-w-0 flex-1'>
                <View className='flex-row items-center' style={{ columnGap: 4 }}>
                  <Text
                    className='min-w-0 shrink text-[16px] font-medium leading-5 tracking-[-0.24px] text-spaces-foreground'
                    numberOfLines={1}
                  >
                    {header.title}
                  </Text>
                  <ChevronDown size={ROOM_HEADER_CHEVRON_SIZE} color={foreground} />
                </View>
                {header.statusEmoji ? (
                  <View className='flex-row items-center' style={{ columnGap: 6 }}>
                    <ReactionEmojiDisplay emojiName={header.statusEmoji} size={14} />
                    {header.statusText ? (
                      <Text
                        className='min-w-0 flex-1 shrink text-[13px] leading-4 text-spaces-subtle'
                        numberOfLines={1}
                      >
                        {header.statusText}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
                {header.subtitle ? (
                  <Text className='text-[13px] leading-4 text-spaces-subtle' numberOfLines={1}>
                    {header.subtitle}
                  </Text>
                ) : null}
              </View>
            </>
          )}
        </Pressable>

        <HeaderButton label='Ask AI' size={ROOM_HEADER_BUTTON_SIZE} onPress={header.onAskAI}>
          <Sparkles size={ROOM_HEADER_BUTTON_ICON_SIZE} color={foreground} />
        </HeaderButton>
        <HeaderButton label='Search' size={ROOM_HEADER_BUTTON_SIZE} onPress={header.onSearch}>
          <Search size={ROOM_HEADER_BUTTON_ICON_SIZE} color={foreground} />
        </HeaderButton>
        <HeaderButton label='Start call' size={ROOM_HEADER_BUTTON_SIZE} onPress={header.onCall}>
          <Phone size={ROOM_HEADER_BUTTON_ICON_SIZE} color={foreground} />
        </HeaderButton>
      </View>
    </View>
  );
}
