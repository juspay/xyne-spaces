import { memo, useState, type ReactElement } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { KeyboardGestureArea } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/src/contexts/AuthContext';
import { getConversationInputMinimumHeight } from '@/src/components/input-composer';
import {
  CHAT_KEYBOARD_GESTURE_INTERPOLATOR,
  CHAT_KEYBOARD_GESTURE_OFFSET,
  CHAT_KEYBOARD_SHOULD_PERSIST_TAPS,
} from '@/src/features/chat/v3/composer/chatKeyboardConfig';
import { useTapToDismissKeyboard } from '@/src/hooks/useTapToDismissKeyboard';

import { EMAIL_CHAIN_H_INSET } from '../../constants';
import { useTicketEmailCollapse } from '../../hooks';
import type { TicketDetailSnapshot } from '../../types';
import { DeskChatComposer } from '../desk-chat-composer';
import { TicketDetailSubjectRow } from '../ticket-detail-subject-row';
import { EmailThread } from './email-thread';
import { MAILBOX_REPLY_BAR_HEIGHT, MailboxReplyBar } from './mailbox-reply-bar';

type EmailTabProps = {
  detail: TicketDetailSnapshot;
  channelId: string;
  contentPaddingTop: number;
  title: string;
  xyneId: string;
  starred: boolean;
  onToggleStar: () => void;
  showMailboxReplyAction?: boolean;
  onReplyPress?: () => void;
  showChatComposer?: boolean;
  /** Gmail From/To/Date expand — false for App/Slack/app-sourced threads. */
  showEmailHeaderChrome?: boolean;
  /** Star control — EMAIL desks only (dashboard MailboxActions). */
  showStar?: boolean;
  isMember?: boolean;
  channelType?: string;
};

export const EmailTab = memo(function EmailTab({
  detail,
  channelId,
  contentPaddingTop,
  title,
  xyneId,
  starred,
  onToggleStar,
  showMailboxReplyAction,
  onReplyPress,
  showChatComposer = false,
  showEmailHeaderChrome = true,
  showStar = false,
  isMember = false,
  channelType = '',
}: EmailTabProps): ReactElement {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const deskEmail = user?.email ?? null;
  const collapse = useTicketEmailCollapse(detail.emails);
  const chatComposerMinimumHeight = getConversationInputMinimumHeight(insets.bottom, true);
  const [chatComposerHeight, setChatComposerHeight] = useState(chatComposerMinimumHeight);
  const tapToDismissKeyboard = useTapToDismissKeyboard(showChatComposer);

  const shouldShowReplyBar = Boolean(
    showMailboxReplyAction && isMember && detail.emails.length > 0,
  );
  const replyBarInset = Math.max(insets.bottom, 12);
  const baseBottomPadding = Math.max(insets.bottom, 24) + 16;
  const replyBarBottomPadding = shouldShowReplyBar ? MAILBOX_REPLY_BAR_HEIGHT + replyBarInset : 0;
  const scrollBottomPadding = showChatComposer
    ? chatComposerHeight + 16
    : baseBottomPadding + replyBarBottomPadding;

  const emptyHint =
    detail.emailCount > 0 || detail.lastEmailAt !== null
      ? 'Loading email thread…'
      : 'No emails in this thread';

  return (
    <View className='flex-1 bg-neutral-100 dark:bg-tabs-screen'>
      <KeyboardGestureArea
        interpolator={CHAT_KEYBOARD_GESTURE_INTERPOLATOR}
        offset={CHAT_KEYBOARD_GESTURE_OFFSET}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={{ flex: 1 }}
          className='bg-neutral-100 dark:bg-tabs-screen'
          contentContainerStyle={{
            paddingTop: contentPaddingTop + 20,
            paddingBottom: scrollBottomPadding,
            paddingHorizontal: EMAIL_CHAIN_H_INSET,
            flexGrow: 1,
          }}
          keyboardDismissMode='interactive'
          keyboardShouldPersistTaps={CHAT_KEYBOARD_SHOULD_PERSIST_TAPS}
          {...(showChatComposer
            ? {
                onTouchStart: tapToDismissKeyboard.onTouchStart,
                onTouchMove: tapToDismissKeyboard.onTouchMove,
                onTouchEnd: tapToDismissKeyboard.onTouchEnd,
              }
            : {})}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ marginHorizontal: -EMAIL_CHAIN_H_INSET }}>
            <TicketDetailSubjectRow
              title={title}
              xyneId={xyneId}
              starred={starred}
              onToggleStar={onToggleStar}
              showStar={showStar}
            />
          </View>

          {detail.emails.length === 0 ? (
            <View className='items-center px-6 pt-10'>
              <Text className='text-[15px] text-secondary-foreground'>{emptyHint}</Text>
            </View>
          ) : (
            <EmailThread
              emails={collapse.sortedEmails}
              collapsedIds={collapse.collapsedIds}
              deskEmail={deskEmail}
              conversationId={detail.conversationId}
              showEmailHeaderChrome={showEmailHeaderChrome}
              onToggleCollapse={collapse.toggleOne}
            />
          )}
        </ScrollView>
      </KeyboardGestureArea>

      {shouldShowReplyBar ? (
        <MailboxReplyBar bottomInset={insets.bottom} onReplyPress={onReplyPress} />
      ) : null}

      {showChatComposer ? (
        <DeskChatComposer
          channelId={channelId}
          channelType={channelType}
          conversationId={detail.conversationId}
          isMember={isMember}
          xyneId={xyneId}
          ticketId={detail.id}
          onHeightChange={setChatComposerHeight}
        />
      ) : null}
    </View>
  );
});
