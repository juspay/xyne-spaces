import { useMemo, type ReactElement, type ReactNode } from 'react';
import { View } from 'react-native';
import {
  ChannelScopeType,
  MessageType,
  parseForwardedMessageXml,
  parseInitialMessageMd,
  User,
} from '@xyne/shared';

import { ConversationComposerContext } from './conversation-composer-context';
import { Content } from './conversation-composer-content';
import { UserDetails } from './conversation-composer-user-details';
import { Timestamp } from './conversation-composer-timestamp';
import { Avatar } from './conversation-composer-avatar';
import { Attachments } from './conversation-composer-attachments';
import { Ticket } from './conversation-composer-ticket';
import { Replies } from './conversation-composer-replies';
import { Forwarded } from './conversation-composer-forwarded';
import { RepliedToThread } from './conversation-composer-replied-to-thread';
import { Edited } from './conversation-composer-edited';
import { Pinned } from './conversation-composer-pinned';
import { Bookmarked } from './conversation-composer-bookmarked';
import { Reactions } from './conversation-composer-reactions';
import { SystemMessage } from './conversation-composer-system-message';
import type { ConversationItem } from './conversation-composer.types';
import { getConversationKind } from './utils/getConversationKind';
import { getParentMessageFromConversation } from '@/src/utils/conversationMessageHelpers';
import { DebugBoundary } from './utils/debug-boundary';
import type { ConversationComposerContentVariant } from './conversation-composer-context';
import type { ChatPaintRow } from '@/src/features/chat/paint/chatPaint.types';
import { chatOpenProfiler } from '@/src/features/chat/chatOpenProfiler';

export { useConversationComposer } from './conversation-composer-context';

type RootProps = {
  item: ConversationItem;
  currentUser: User | undefined;
  channelType?: ChannelScopeType;
  children: ReactNode;
  contentVariant?: ConversationComposerContentVariant;
  paintRow?: ChatPaintRow;
  allowMediaHydration?: boolean;
};

const Root = ({
  item,
  currentUser,
  channelType,
  children,
  contentVariant = 'primary',
  paintRow,
  allowMediaHydration = true,
}: RootProps): ReactElement => {
  chatOpenProfiler.count('conversation_composer_root_render');
  const summary = useMemo(
    () => parseInitialMessageMd(item.initial_message_md),
    [item.initial_message_md],
  );
  const forwarded = useMemo(
    () =>
      summary?.msgType === MessageType.FORWARDED ? parseForwardedMessageXml(summary.content) : null,
    [summary],
  );
  const parentMessage = useMemo(
    () => getParentMessageFromConversation({ parent_message_md: item.parent_message_md ?? null }),
    [item.parent_message_md],
  );
  const kind = useMemo(() => getConversationKind(summary, currentUser?.id), [summary, currentUser]);
  const value = useMemo(
    () => ({
      item,
      currentUser,
      kind,
      channelType,
      summary,
      forwarded,
      parentMessage,
      contentVariant,
      allowMediaHydration,
      ...(paintRow ? { paintRow } : {}),
    }),
    [
      item,
      currentUser,
      kind,
      channelType,
      summary,
      forwarded,
      parentMessage,
      contentVariant,
      allowMediaHydration,
      paintRow,
    ],
  );
  return (
    <ConversationComposerContext.Provider value={value}>
      <DebugBoundary>
        <View>{children}</View>
      </DebugBoundary>
    </ConversationComposerContext.Provider>
  );
};
Root.displayName = 'ConversationComposer.Root';

const ConversationComposer = {
  Root,
  Content,
  UserDetails,
  Timestamp,
  Avatar,
  Attachments,
  Ticket,
  Replies,
  Forwarded,
  RepliedToThread,
  Edited,
  Pinned,
  Bookmarked,
  Reactions,
  SystemMessage,
};

export { ConversationComposer };
