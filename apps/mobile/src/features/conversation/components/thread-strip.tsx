import { memo, useMemo, type ReactElement } from 'react';
import { Pressable, Text } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';

import {
  THREAD_STRIP_AVATAR_OVERLAP,
  THREAD_STRIP_AVATAR_SIZE,
  THREAD_STRIP_GAP,
  THREAD_STRIP_HEIGHT,
  THREAD_STRIP_MAX_AVATARS,
  THREAD_STRIP_PADDING,
  THREAD_STRIP_RADIUS,
} from '../constants';
import { replyCountLabel, stripRepliers, stripTime } from '../model/thread-strip';
import { OverlappingAvatars } from './overlapping-avatars';

type ThreadStripProps = {
  paintRow: ChatPaintRow;
  /** When the thread last moved (ms), shown on the right as a short relative time. */
  lastActivityAt?: number | undefined;
  onPress: () => void;
};

/** "3 replies" under a message; opens the thread like tapping the message does. */
export const ThreadStrip = memo(function ThreadStrip({
  paintRow,
  lastActivityAt,
  onPress,
}: ThreadStripProps): ReactElement {
  const subtle = useCSSVariable('--color-spaces-subtle') as string;
  const count = paintRow.replyPreview?.count ?? paintRow.replyCount;
  const replierIds = paintRow.replyPreview?.latestReplierIds ?? paintRow.replyPreviewUserIds;
  const repliers = useMemo(
    () => stripRepliers(replierIds ?? [], THREAD_STRIP_MAX_AVATARS),
    [replierIds],
  );

  const time = stripTime(lastActivityAt, Date.now());

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={`Open thread, ${replyCountLabel(count)}`}
      onPress={onPress}
      className='flex-row items-center border border-spaces-outline bg-spaces-background shadow-xs'
      style={{
        height: THREAD_STRIP_HEIGHT,
        borderRadius: THREAD_STRIP_RADIUS,
        paddingHorizontal: THREAD_STRIP_PADDING,
        gap: THREAD_STRIP_GAP,
      }}
    >
      {repliers.length > 0 ? (
        <OverlappingAvatars
          userIds={repliers}
          size={THREAD_STRIP_AVATAR_SIZE}
          overlap={THREAD_STRIP_AVATAR_OVERLAP}
        />
      ) : null}
      <Text className='flex-1 text-[14px] leading-[18px] text-spaces-muted' numberOfLines={1}>
        {replyCountLabel(count)}
      </Text>
      {time ? <Text className='text-[14px] leading-[18px] text-spaces-subtle'>{time}</Text> : null}
      <ChevronRight size={16} color={subtle} />
    </Pressable>
  );
});
