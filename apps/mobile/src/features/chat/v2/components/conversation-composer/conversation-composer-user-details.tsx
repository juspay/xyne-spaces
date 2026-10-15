import { memo, type ReactElement } from 'react';
import { Pressable, type GestureResponderEvent } from 'react-native';
import { ChannelScopeType, parseTicketMd } from '@xyne/shared';

import { PaintSenderNameLabel } from '@/src/features/chat/v2/components/chat/paint-sender-name-label';
import { useChatUserProfileActionsSheet } from '@/src/features/chat/v2/components/chat/chat-user-profile-actions-sheet';
import { useConversationComposer } from './conversation-composer-context';
import { useUser } from '@/src/hooks/useUsers';
import { useUserColor } from './utils/getUserColor';
import { useOpenUserDm } from './utils/useOpenUserDm';
import { DebugBoundary } from './utils/debug-boundary';

type UserDetailsProps = {
  className?: string;
  showCurrentUser?: boolean;
};

const UserDetails = memo(
  ({ className, showCurrentUser = false }: UserDetailsProps): ReactElement | null => {
    const { item, summary, kind, channelType, paintRow, currentUser } = useConversationComposer();
    const senderId = summary?.senderId ?? paintRow?.senderPaintModel.senderId ?? '';
    const sender = useUser(paintRow ? '' : senderId);
    const isCurrentUserMessage = !!senderId && senderId === currentUser?.id;
    const senderForDisplay = sender ?? (isCurrentUserMessage ? currentUser : undefined);
    const color = useUserColor(senderId);
    const { openUserDm, busy } = useOpenUserDm();
    const profileActions = useChatUserProfileActionsSheet();
    const showForDefaultKind =
      kind === 'OTHER_USER' ||
      kind === 'BOT' ||
      paintRow?.rowKind === 'OTHER_USER' ||
      paintRow?.rowKind === 'BOT';
    const shouldShowCurrentUser = showCurrentUser && isCurrentUserMessage;

    if (channelType === ChannelScopeType.DM && !shouldShowCurrentUser) {
      return null;
    }
    if (paintRow?.ticketPreview || parseTicketMd(item.ticket_md ?? null)) return null;
    if (paintRow && !paintRow.showSenderName && !shouldShowCurrentUser) {
      return null;
    }
    if (!showForDefaultKind && !shouldShowCurrentUser) return null;
    const senderName =
      paintRow?.senderPaintModel.displayName ??
      (isCurrentUserMessage
        ? (senderForDisplay?.displayName ??
          senderForDisplay?.name ??
          senderForDisplay?.email ??
          'You')
        : sender?.name);
    if (!senderName) return null;

    const handlePress = (event: GestureResponderEvent): void => {
      event.stopPropagation();
      if (profileActions) {
        profileActions.openUserProfileActions({
          userId: senderId,
          displayName: senderName,
          email: senderForDisplay?.email,
        });
        return;
      }
      void openUserDm(senderId);
    };

    return (
      <DebugBoundary>
        <Pressable
          onPress={handlePress}
          disabled={!senderId || (!profileActions && busy)}
          hitSlop={4}
          style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
        >
          <PaintSenderNameLabel
            senderId={senderId}
            displayName={senderName}
            color={color}
            {...(className !== undefined ? { className } : {})}
          />
        </Pressable>
      </DebugBoundary>
    );
  },
);
UserDetails.displayName = 'ConversationComposer.UserDetails';

export { UserDetails };
