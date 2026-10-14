import { memo, type ReactElement } from 'react';
import { Text, View, type TextStyle } from 'react-native';
import { AlarmClock, Bookmark } from 'lucide-react-native';
import { BookmarkEntityType } from '@xyne/shared';

import { useUserBookmarks } from '@/src/hooks/useUserBookmarks';
import {
  getPendingReminderFromMetadata,
  getReminderDueInLabel,
} from '@/src/features/chat/v2/components/message-actions-sheet/message-reminder-utils';

type MessageBookmarkReminderIndicatorProps = {
  messageId: string | null | undefined;
  iconColor: string;
  textStyle?: TextStyle | undefined;
};

const MessageBookmarkReminderIndicatorComponent = ({
  messageId,
  iconColor,
  textStyle,
}: MessageBookmarkReminderIndicatorProps): ReactElement | null => {
  const { isEntityBookmarked } = useUserBookmarks();
  if (!messageId) return null;

  const bookmark = isEntityBookmarked(messageId, BookmarkEntityType.MESSAGE);
  if (!bookmark) return null;

  const reminder = getPendingReminderFromMetadata(bookmark.metadata);

  return (
    <View className='flex-row items-center gap-1'>
      {reminder ? (
        <>
          <AlarmClock size={12} color={iconColor} />
          <Text
            className='max-w-[150px] text-[11px] leading-3 text-foreground/70'
            numberOfLines={1}
            style={textStyle}
          >
            {`Reminder Set - ${getReminderDueInLabel(reminder)}`}
          </Text>
        </>
      ) : null}
      <Bookmark size={12} color={iconColor} fill={iconColor} />
    </View>
  );
};

export const MessageBookmarkReminderIndicator = memo(MessageBookmarkReminderIndicatorComponent);
MessageBookmarkReminderIndicator.displayName = 'MessageBookmarkReminderIndicator';
