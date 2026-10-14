import { AlarmClock, AlertCircle, Bookmark, Clock, Pin } from 'lucide-react-native';
import { type ReactElement } from 'react';
import { Text, View } from 'react-native';

import type { MessageRowModel } from '../model/chatRow.types';
import { statusChromeFor } from '../model/statusChrome';
import { useChatRenderTokens } from '../theme/ChatRenderProvider';
import { MessageReplyTray } from './MessageReplyTray';

/**
 * Bubble trailing meta: reply tray left, status + timestamp right.
 *
 * v2: `border-t` + `pt-2` only on plain-text rows with a reply tray. No extra
 * bottom pad — the tray's 18px avatars fill `MESSAGE_REPLY_HEIGHT`.
 */
export function MessageRowMeta({
  model,
  pendingStatus,
  replyCount,
  showReplyBorder,
}: {
  model: MessageRowModel;
  pendingStatus: string | null;
  replyCount: number;
  showReplyBorder: boolean;
}): ReactElement {
  const tokens = useChatRenderTokens();
  const mine = model.rowKind === 'CURRENT_USER';
  const metaColor = mine ? tokens.rootMetaUser : tokens.mutedForeground;
  const iconColor = mine ? tokens.rootMetaUser : '#999';
  const accentColor = mine ? tokens.rootAccentUser : tokens.actionPrimaryColor;
  const status = statusChromeFor(model);

  return (
    <View
      className={`flex-row items-end gap-1 ${showReplyBorder ? 'border-t border-border pt-2' : ''}`}
    >
      <MessageReplyTray
        replyCount={replyCount}
        replierUserIds={model.replyPreview?.latestReplierIds ?? []}
        accentColor={accentColor}
      />
      <View className='flex-1' />
      {status.showEdited ? (
        <Text className='text-[10px] text-secondary-foreground italic'>(edited)</Text>
      ) : null}
      {status.showBookmark ? (
        <View className='flex-row items-center gap-1'>
          {status.reminderLabel ? (
            <>
              <AlarmClock size={12} color={iconColor} />
              <Text
                className='max-w-[150px] text-[11px] leading-3 text-foreground/70'
                numberOfLines={1}
                style={mine ? { color: metaColor } : undefined}
              >
                {status.reminderLabel}
              </Text>
            </>
          ) : null}
          <Bookmark size={12} color={iconColor} fill={iconColor} />
        </View>
      ) : null}
      {status.showPinned ? <Pin size={12} color={iconColor} fill={iconColor} /> : null}
      {pendingStatus === 'connecting' ? <Clock size={12} color={iconColor} /> : null}
      {pendingStatus === 'failed' ? <AlertCircle size={12} color='#e53935' /> : null}
      <Text
        className={`text-[10px] ${mine ? '' : 'text-conversation-composer-timestamp-other'}`}
        style={mine ? { color: metaColor } : undefined}
      >
        {model.timeLabel}
      </Text>
    </View>
  );
}
