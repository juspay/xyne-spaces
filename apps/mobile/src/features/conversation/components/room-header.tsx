import { type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, ChevronLeft, Phone, Search } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import {
  ConversationHeaderIcon,
  HeaderPresenceDot,
} from '@/src/components/chat/conversation-header-icon';
import { ConversationHeaderTitleSkeleton } from '@/src/components/chat/conversation-header-title-skeleton';
import { Spark4Icon } from '@/src/components/icons';
import { AvatarFace } from '@/src/ui/avatar';
import { haptics } from '@/src/utils/haptics';

import {
  FIND_HEADER_PADDING_RIGHT,
  ROOM_HEADER_AVATAR_SIZE,
  ROOM_HEADER_BUTTON_ICON_SIZE,
  ROOM_HEADER_CALL_CHEVRON_MARGIN_LEFT,
  ROOM_HEADER_CHANNEL_TITLE_PADDING_LEFT,
  ROOM_HEADER_BUTTON_SIZE,
  ROOM_HEADER_CHEVRON_SIZE,
  ROOM_HEADER_DM_AVATAR_PADDING_LEFT,
  ROOM_HEADER_DM_TITLE_PADDING_LEFT,
  ROOM_HEADER_HEIGHT,
  ROOM_HEADER_PADDING_LEFT,
  ROOM_HEADER_PADDING_RIGHT,
  ROOM_HEADER_TITLE_CHEVRON_GAP,
  ROOM_HEADER_TITLE_GAP,
} from '../constants';
import { useChannelFindControls } from '../hooks/use-channel-find';
import { useRoomHeader } from '../hooks/use-room-header';
import { colorOf } from '../model/token-color';
import { FindField } from './find-field';
import { IconButton } from './icon-button';

type RoomHeaderProps = {
  channelId: string;
  postPaintReady: boolean;
  onBack: () => void;
};

export function RoomHeader({ channelId, postPaintReady, onBack }: RoomHeaderProps): ReactElement {
  const insets = useSafeAreaInsets();
  const foreground = colorOf(useCSSVariable('--color-spaces-foreground'));
  const header = useRoomHeader(channelId, postPaintReady);
  // Find in this channel: its Search button opens it, and while open the field replaces the title.
  const find = useChannelFindControls();
  const isDm = header.kind === 'dm';
  // A DM has no Search button, so it never finds.
  const isFinding = find.isOpen && !isDm;

  return (
    <View className='bg-spaces-background' style={{ paddingTop: insets.top }}>
      <View
        className='flex-row items-center'
        style={{
          height: ROOM_HEADER_HEIGHT,
          paddingLeft: ROOM_HEADER_PADDING_LEFT,
          paddingRight: isFinding ? FIND_HEADER_PADDING_RIGHT : ROOM_HEADER_PADDING_RIGHT,
        }}
      >
        <IconButton label='Back' size={ROOM_HEADER_BUTTON_SIZE} onPress={onBack}>
          <ChevronLeft size={ROOM_HEADER_BUTTON_ICON_SIZE} color={foreground} />
        </IconButton>

        {isFinding ? (
          <FindField
            placeholder={header.isTitlePending ? 'Find in this channel' : `Find in ${header.title}`}
            onQueryCommit={find.onQueryCommit}
            onCancel={find.close}
          />
        ) : (
          <>
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Conversation info'
              onPress={header.onOpenInfo}
              className='min-w-0 flex-1 flex-row items-center active:opacity-60'
              style={{
                paddingLeft: isDm
                  ? ROOM_HEADER_DM_AVATAR_PADDING_LEFT
                  : ROOM_HEADER_CHANNEL_TITLE_PADDING_LEFT,
                columnGap: ROOM_HEADER_TITLE_GAP,
              }}
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
                  <View
                    className='min-w-0 flex-1'
                    style={isDm ? { paddingLeft: ROOM_HEADER_DM_TITLE_PADDING_LEFT } : undefined}
                  >
                    <View
                      className='flex-row items-center'
                      style={{ columnGap: ROOM_HEADER_TITLE_CHEVRON_GAP }}
                    >
                      <Text
                        className='min-w-0 shrink text-[16px] font-medium leading-5 tracking-[-0.24px] text-spaces-foreground'
                        numberOfLines={1}
                      >
                        {header.title}
                      </Text>
                      {isDm ? null : (
                        <ChevronDown size={ROOM_HEADER_CHEVRON_SIZE} color={foreground} />
                      )}
                    </View>
                    {header.subtitle ? (
                      <Text className='text-[12px] leading-4 text-spaces-subtle' numberOfLines={1}>
                        {header.subtitle}
                      </Text>
                    ) : null}
                  </View>
                </>
              )}
            </Pressable>

            <IconButton label='Ask AI' size={ROOM_HEADER_BUTTON_SIZE} onPress={header.onAskAI}>
              <Spark4Icon size={ROOM_HEADER_BUTTON_ICON_SIZE} color={foreground} />
            </IconButton>
            {isDm ? null : (
              <IconButton
                label='Find in this channel'
                size={ROOM_HEADER_BUTTON_SIZE}
                onPress={find.open}
              >
                <Search size={ROOM_HEADER_BUTTON_ICON_SIZE} color={foreground} />
              </IconButton>
            )}
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Start call'
              onPressIn={() => void haptics.buttonTap()}
              onPress={header.onCall}
              className='flex-row items-center rounded-full active:opacity-60'
              style={{ height: ROOM_HEADER_BUTTON_SIZE }}
            >
              <View
                className='items-center justify-center'
                style={{ width: ROOM_HEADER_BUTTON_SIZE, height: ROOM_HEADER_BUTTON_SIZE }}
              >
                <Phone size={ROOM_HEADER_BUTTON_ICON_SIZE} color={foreground} />
              </View>
              <ChevronDown
                size={ROOM_HEADER_CHEVRON_SIZE}
                color={foreground}
                style={{ marginLeft: ROOM_HEADER_CALL_CHEVRON_MARGIN_LEFT }}
              />
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}
