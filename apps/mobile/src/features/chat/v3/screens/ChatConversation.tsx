import { type ReactElement } from 'react';

import type { OpenIntent } from '../intent/openIntent.types';
import { aroundCursorFor } from '../data/useConversationWindow';
import { EMPTY_WINDOW } from '../data/normalizeConversationWindow';
import { ChatConversationView } from './ChatConversationView';
import { useChatOpen, useChatOpenWindow, type ChatOpenSession } from './useChatOpen';

import type { ResolvedLocation } from '../intent/resolvedLocation';
import type { Result } from '../intent/openIntent.types';
import type { OpenFailure } from '../types/openFailure';

export type ChatConversationProps = {
  intent: OpenIntent;
  location: Result<ResolvedLocation, OpenFailure> | null;
  parentTicketMd?: string | null;
  parentTicketId?: string | null;
  isTranscript?: boolean;
  onParentTicketPress?: () => void;
  onBeforeMarkUnread?: () => void;
  onMarkUnreadFailure?: () => void;
  onVisible?: (row: { conversationId: string; createdAt: number } | null, atEnd: boolean) => void;
};

type HostProps = {
  intent: OpenIntent;
  session: ChatOpenSession;
  parentTicketMd: string | null;
  parentTicketId: string | null;
  isTranscript: boolean;
  onParentTicketPress?: () => void;
  onBeforeMarkUnread?: () => void;
  onMarkUnreadFailure?: () => void;
  onVisible?: NonNullable<ChatConversationProps['onVisible']>;
};

/**
 * Two opens, one subscribe rule:
 *
 *   tail   — tap / unread / share / restore. Subscribe now (latest page).
 *            Unread is a divider in the list, not a landing.
 *   anchor — notification, activity, deeplink, search, forward.
 *            Channel waits for the around-cursor. Thread subscribes now.
 */
export function ChatConversation({
  intent,
  location,
  parentTicketMd = null,
  parentTicketId = null,
  isTranscript = false,
  onParentTicketPress,
  onBeforeMarkUnread,
  onMarkUnreadFailure,
  onVisible,
}: ChatConversationProps): ReactElement {
  const session = useChatOpen(intent, location);
  const aroundCursor = aroundCursorFor(intent, session.target);
  const host: HostProps = {
    intent,
    session,
    parentTicketMd,
    parentTicketId,
    isTranscript,
    ...(onParentTicketPress !== undefined ? { onParentTicketPress } : {}),
    ...(onBeforeMarkUnread !== undefined ? { onBeforeMarkUnread } : {}),
    ...(onMarkUnreadFailure !== undefined ? { onMarkUnreadFailure } : {}),
    ...(onVisible !== undefined ? { onVisible } : {}),
  };
  if (intent.surface.kind === 'channel' && session.target.kind === 'anchor' && aroundCursor <= 0) {
    return <ChatConversationView {...host} window={EMPTY_WINDOW} />;
  }
  return <ChatConversationSubscribed {...host} />;
}

function ChatConversationSubscribed(props: HostProps): ReactElement {
  const { intent, session } = props;
  const window = useChatOpenWindow(
    intent,
    session.target,
    session.state,
    session.dispatch,
    session.warmWindow,
  );
  return <ChatConversationView {...props} window={window} />;
}
