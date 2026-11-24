import { useMemo, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronDown, Minus } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { parseRepliesMd } from '@xyne/shared';

import { useThreadHeaderActions } from '@/src/components/chat/thread-header-v3/use-thread-header-actions';
import { useConversationHeaderData } from '@/src/hooks/useConversationHeaderData';

import {
  THREAD_HEADER_AVATAR_OVERLAP,
  THREAD_HEADER_AVATAR_SIZE,
  THREAD_HEADER_BUTTON_SIZE,
  THREAD_HEADER_GAP,
  THREAD_HEADER_HEIGHT,
  THREAD_HEADER_ICON_SIZE,
  THREAD_HEADER_MAX_AVATARS,
  THREAD_HEADER_PADDING_TOP,
  THREAD_HEADER_PADDING_X,
  THREAD_HEADER_Z_INDEX,
} from '../constants';
import { useParkThread } from '../hooks/use-park-thread';
import { useSelfFace } from '../hooks/use-self-face';
import { roomKindOf, roomTitle } from '../model/room-title';
import { replyCountLabel, stripRepliers } from '../model/thread-strip';
import { colorOf } from '../model/token-color';
import { IconButton } from './icon-button';
import { OverlappingAvatars } from './overlapping-avatars';

type ThreadHeaderProps = {
  channelId: string;
  threadId: string;
  onBack: () => void;
};

/**
 * The thread card's header (Figma "6 · A thread, opened"): collapse on the
 * left, park on the right, and the repliers with their count between them
 * (which opens the parent conversation). Both controls leave the thread;
 * park also keeps it as a bubble over the room.
 * Absolutely positioned, because the thread screen reserves its height with a
 * spacer below it.
 */
export function ThreadHeader({ channelId, threadId, onBack }: ThreadHeaderProps): ReactElement {
  const foreground = colorOf(useCSSVariable('--color-spaces-foreground'));
  const { channel, displayName, isDM } = useConversationHeaderData(channelId, { enabled: false });
  const { replyCount, repliesMd, rootMessage, handleOpenParentConversation } =
    useThreadHeaderActions({
      channelId,
      threadId,
      channel,
      isDM,
    });
  const replierIds = useMemo(
    () => stripRepliers(parseRepliesMd(repliesMd).repliers, THREAD_HEADER_MAX_AVATARS),
    [repliesMd],
  );
  const self = useSelfFace();
  const park = useParkThread({
    channelId,
    threadId,
    channelName: roomTitle(displayName, roomKindOf(channel?.scopeType)),
    rootMessage,
    repliesMd,
    onBack,
  });

  return (
    <View
      className='absolute left-0 right-0 top-0 bg-spaces-background'
      style={{
        zIndex: THREAD_HEADER_Z_INDEX,
        height: THREAD_HEADER_HEIGHT,
        paddingTop: THREAD_HEADER_PADDING_TOP,
        paddingHorizontal: THREAD_HEADER_PADDING_X,
      }}
    >
      <View
        className='flex-row items-center'
        style={{ height: THREAD_HEADER_BUTTON_SIZE, columnGap: THREAD_HEADER_GAP }}
      >
        <IconButton
          label='Collapse thread'
          size={THREAD_HEADER_BUTTON_SIZE}
          onPress={onBack}
          className='bg-spaces-surface'
        >
          <ChevronDown size={THREAD_HEADER_ICON_SIZE} color={foreground} />
        </IconButton>

        <Pressable
          accessibilityRole='button'
          accessibilityLabel={`Open conversation ${displayName}`}
          onPress={handleOpenParentConversation}
          className='min-w-0 flex-1 flex-row items-center justify-center active:opacity-60'
          style={{ columnGap: THREAD_HEADER_GAP }}
        >
          <OverlappingAvatars
            userIds={replierIds}
            size={THREAD_HEADER_AVATAR_SIZE}
            overlap={THREAD_HEADER_AVATAR_OVERLAP}
            self={self}
          />
          <Text
            className='shrink text-[16px] font-medium leading-5 text-spaces-foreground'
            numberOfLines={1}
          >
            {replyCount > 0 ? replyCountLabel(replyCount) : 'Thread'}
          </Text>
        </Pressable>

        <IconButton
          label='Park thread'
          size={THREAD_HEADER_BUTTON_SIZE}
          onPress={park}
          className='bg-spaces-surface'
        >
          <Minus size={THREAD_HEADER_ICON_SIZE} color={foreground} />
        </IconButton>
      </View>
    </View>
  );
}
