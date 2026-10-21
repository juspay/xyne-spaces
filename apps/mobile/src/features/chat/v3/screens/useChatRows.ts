import { BookmarkEntityType } from '@xyne/shared';
import { useMemo, useRef } from 'react';

import { conversationsForRows } from '../data/conversationsForRows';
import { injectParentTicket } from '../data/injectParentTicket';
import { useChatSubscriptions } from '../data/useChatSubscriptions';
import { toConversationInput } from '../data/toConversationInput';
import type { ConversationWindow } from '../data/normalizeConversationWindow';
import type { OpenIntent } from '../intent/openIntent.types';
import type { LandingTarget } from '../machine/openState';
import { buildRows } from '../model/buildRows';
import { applyThreadReplyChrome } from '../model/threadReplyChrome';
import { channelKindOf } from '../model/conversationInput';
import type { ChatRow } from '../model/chatRow.types';
import type { WarmWindow } from '../warm/warmWindow.types';

/**
 * Builds the paint-ready row model from the live/warm window.
 *
 * The `map → toConversationInput → buildRows` pipeline is pure given its
 * inputs, but it is O(n) over the whole window and does a `JSON.parse` per
 * message (attachments, link previews, reactions). It must NOT re-run on every
 * render — only when a real input changes — otherwise unrelated re-renders
 * (keyboard show/hide, jump-to-latest toggle, viewport sync) each pay the full
 * rebuild cost on the main thread. `reuseUnchanged` inside `buildRows` keeps
 * row *identities* stable so rows do not re-render; this memo keeps the
 * *rebuild itself* from firing.
 *
 * Deps are the stable references the pipeline actually reads:
 *   - `conversations` — the source window (stable Zero query refs; the
 *     `conversationsForRows` selection is a length check, cheap to run raw).
 *   - `isEntityBookmarked` — a `useCallback` whose identity changes exactly
 *     when bookmark data changes, so bookmark toggles still repaint.
 *   - channel kind, current user, thread id, and the frozen unread divider
 *     from the list-tap hint (not a landing — we always pack at the last message).
 * `previous` is a ref (stable) and is intentionally excluded from deps.
 */
export const useChatRows = (
  intent: OpenIntent,
  window: ConversationWindow,
  warm: WarmWindow | null = null,
  parentTicketMd: string | null = null,
  parentTicketId: string | null = null,
  target: LandingTarget = { kind: 'tail' },
): ChatRow[] => {
  const { channel, self, bookmarks } = useChatSubscriptions(intent.surface.channelId);
  const previous = useRef<readonly ChatRow[]>([]);
  const currentUserId = self?.id ?? '';
  const channelId = intent.surface.channelId;
  const threadId = intent.surface.kind === 'channel' ? undefined : intent.surface.threadId;
  const scopeType = channel?.scopeType;
  const unreadBoundaryAt = intent.hint.unreadBoundaryAt;
  const unreadBoundaryConversationId = intent.hint.unreadBoundaryConversationId;
  const { isEntityBookmarked } = bookmarks;
  const conversations = injectParentTicket(
    conversationsForRows(window, warm, target),
    parentTicketMd,
    parentTicketId,
  );

  return useMemo(() => {
    const inputs = conversations
      .map((row, index) =>
        toConversationInput(row, {
          channelId,
          currentUserId,
          isBookmarked: (messageId: string): boolean =>
            Boolean(isEntityBookmarked(messageId, BookmarkEntityType.MESSAGE)),
          ...(threadId ? { threadId, threadIndex: index } : {}),
        }),
      )
      .filter((row): row is NonNullable<typeof row> => row !== null);
    const rows = applyThreadReplyChrome(
      buildRows(inputs, {
        channelId,
        channelKind: channelKindOf(scopeType),
        currentUserId,
        ...(unreadBoundaryAt !== undefined ? { unreadBoundaryAt } : {}),
        ...(unreadBoundaryConversationId !== undefined ? { unreadBoundaryConversationId } : {}),
        previousRows: previous.current,
      }),
      !!threadId,
    );
    previous.current = rows;
    return rows;
  }, [
    conversations,
    channelId,
    currentUserId,
    threadId,
    scopeType,
    unreadBoundaryAt,
    unreadBoundaryConversationId,
    isEntityBookmarked,
  ]);
};
