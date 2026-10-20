import { useMemo, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, Minus, Sparkles } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { parseRepliesMd } from '@xyne/shared';

import { useThreadHeaderActions } from '@/src/components/chat/thread-header-v3/use-thread-header-actions';
import { useConversationHeaderData } from '@/src/hooks/useConversationHeaderData';

import {
  THREAD_HEADER_AVATAR_OVERLAP,
  THREAD_HEADER_AVATAR_SIZE,
  THREAD_HEADER_BUTTON_SIZE,
  THREAD_HEADER_HEIGHT,
  THREAD_HEADER_MAX_AVATARS,
} from '../constants';
import { replyCountLabel, stripRepliers } from '../model/thread-strip';
import { HeaderButton } from './header-button';
import { OverlappingAvatars } from './overlapping-avatars';

type ThreadHeaderProps = {
  channelId: string;
  threadId: string;
  onBack: () => void;
};

/**
 * The thread's header: a back button, the repliers and their count (which opens
 * the parent conversation), Ask AI scoped to the thread, and a close button.
 * Back and close both leave the thread; the card-over-the-room presentation
 * that would give them different jobs is a later phase. Absolutely positioned,
 * because the thread screen reserves its height with a spacer below it.
 */
export function ThreadHeader({ channelId, threadId, onBack }: ThreadHeaderProps): ReactElement {
  const insets = useSafeAreaInsets();
  const foreground = useCSSVariable('--color-spaces-foreground') as string;
  const { channel, displayName, isDM } = useConversationHeaderData(channelId, { enabled: false });
  const { replyCount, repliesMd, handleOpenParentConversation, handleAskAI } =
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

  return (
    <View
      className='absolute left-0 right-0 top-0 bg-spaces-background'
      style={{ zIndex: 40, paddingTop: insets.top, height: THREAD_HEADER_HEIGHT + insets.top }}
    >
      <View className='flex-1 flex-row items-center px-4' style={{ columnGap: 8 }}>
        <HeaderButton
          label='Back'
          size={THREAD_HEADER_BUTTON_SIZE}
          onPress={onBack}
          className='bg-spaces-surface'
        >
          <ChevronDown size={20} color={foreground} />
        </HeaderButton>

        <Pressable
          accessibilityRole='button'
          accessibilityLabel={`Open conversation ${displayName}`}
          onPress={handleOpenParentConversation}
          className='min-w-0 flex-1 flex-row items-center justify-center active:opacity-60'
          style={{ columnGap: 8 }}
        >
          <OverlappingAvatars
            userIds={replierIds}
            size={THREAD_HEADER_AVATAR_SIZE}
            overlap={THREAD_HEADER_AVATAR_OVERLAP}
          />
          <Text
            className='shrink text-[16px] font-medium leading-5 text-spaces-foreground'
            numberOfLines={1}
          >
            {replyCount > 0 ? replyCountLabel(replyCount) : 'Thread'}
          </Text>
        </Pressable>

        <HeaderButton
          label='Ask AI'
          size={THREAD_HEADER_BUTTON_SIZE}
          onPress={handleAskAI}
          className='bg-spaces-surface'
        >
          <Sparkles size={20} color={foreground} />
        </HeaderButton>

        <HeaderButton
          label='Close thread'
          size={THREAD_HEADER_BUTTON_SIZE}
          onPress={onBack}
          className='bg-spaces-surface'
        >
          <Minus size={20} color={foreground} />
        </HeaderButton>
      </View>
    </View>
  );
}
