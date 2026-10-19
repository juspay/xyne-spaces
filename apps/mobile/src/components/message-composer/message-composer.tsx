import { useMemo, type ReactElement, type ReactNode } from 'react';
import { View } from 'react-native';
import { User } from '@xyne/shared';

import { MessageComposerContext } from './message-composer-context';
import { Avatar } from './message-composer-avatar';
import { UserDetails } from './message-composer-user-details';
import { Content } from './message-composer-content';
import { Attachments } from './message-composer-attachments';
import { Reactions } from './message-composer-reactions';
import { Timestamp } from './message-composer-timestamp';
import { Edited } from './message-composer-edited';
import { Deleted } from './message-composer-deleted';
import { Forwarded } from './message-composer-forwarded';
import { Bookmarked } from './message-composer-bookmarked';
import { Pinned } from './message-composer-pinned';
import type { MessageItem } from './message-composer.types';
import { getMessageKind, isContinuationOf } from './utils/getMessageKind';
import { DebugBoundary } from './utils/debug-boundary';
import type { MessageComposerContentVariant } from './message-composer-context';

export { useMessageComposer } from './message-composer-context';

type RootProps = {
  item: MessageItem;
  previousMessage?: MessageItem | undefined;
  currentUser: User | undefined;
  children: ReactNode;
  contentVariant?: MessageComposerContentVariant;
};

const Root = ({
  item,
  previousMessage,
  currentUser,
  children,
  contentVariant = 'primary',
}: RootProps): ReactElement => {
  const kind = useMemo(() => getMessageKind(item, currentUser), [item, currentUser]);
  const isContinuation = useMemo(
    () => isContinuationOf(item, previousMessage),
    [item, previousMessage],
  );
  const value = useMemo(
    () => ({ item, previousMessage, currentUser, kind, isContinuation, contentVariant }),
    [item, previousMessage, currentUser, kind, isContinuation, contentVariant],
  );
  return (
    <MessageComposerContext.Provider value={value}>
      <DebugBoundary>
        <View>{children}</View>
      </DebugBoundary>
    </MessageComposerContext.Provider>
  );
};
Root.displayName = 'MessageComposer.Root';

const MessageComposer = {
  Root,
  Avatar,
  UserDetails,
  Content,
  Attachments,
  Reactions,
  Timestamp,
  Edited,
  Deleted,
  Forwarded,
  Bookmarked,
  Pinned,
};

export { MessageComposer };
