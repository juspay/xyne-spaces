import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Keyboard } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';

import { type User } from '@xyne/shared';

import type { ReactionPreviewItem } from '@/src/features/chat/v2/paint/chatPaint.types';
import { reactionsMdToRawReactions } from '@/src/utils/conversationMessageHelpers';
import {
  groupReactionsForPill,
  totalReactionCount,
  type RawReaction,
} from '@/src/components/chat/message/reactions/reaction-pill.utils';
import { useUsers } from '@/src/hooks/useUsers';
import { useZero } from '@/src/hooks/useZero';
import { mutators } from '@/src/zero/mutators';
import { useAuth } from '@/src/contexts/AuthContext';
import { dismissRegisteredComposerFocus } from '@/src/utils/composerFocusDismissRegistry';

import {
  ReactionsBottomSheet,
  type ReactionRow,
} from '../conversation-composer/conversation-composer-reactions';
import { getConversationReactionsMd } from '../conversation-composer/utils/getConversationReactionsMd';
import type { ConversationItem } from '../conversation-composer';

type ReactionsSheetTarget = {
  conversationId: string;
  messageId: string;
  fallbackReactions?: ReactionPreviewItem[] | undefined;
};

type ReactionsSheetContextValue = {
  openReactions: (target: ReactionsSheetTarget) => void;
};

const NOOP_CONTEXT: ReactionsSheetContextValue = {
  openReactions: () => {},
};

const ReactionsSheetContext = createContext<ReactionsSheetContextValue>(NOOP_CONTEXT);

/**
 * Consumed by reaction pills (lite/paint and ticket/system rows) to open the
 * shared "who reacted" drawer. The host resolves the reactor list from live
 * data, so callers only need to pass the conversation + message id.
 */
export const useReactionsSheet = (): ReactionsSheetContextValue =>
  useContext(ReactionsSheetContext);

type ReactionsSheetHostProps = {
  getConversationById: (conversationId: string) => ConversationItem | undefined;
  currentUser: User | undefined;
  children: ReactNode;
};

/**
 * Single screen-level owner of the reactor-list bottom sheet. Mounted once by
 * ChatList so EVERY row variant (lite paint rows, ticket/system MessageRows,
 * and not-yet-promoted rows) can open the same drawer — the rich composer keeps
 * its own inline sheet, but both render the identical `ReactionsBottomSheet`.
 */
export const ReactionsSheetHost = ({
  getConversationById,
  currentUser,
  children,
}: ReactionsSheetHostProps): ReactElement => {
  const [target, setTarget] = useState<ReactionsSheetTarget | null>(null);

  const openReactions = useCallback((next: ReactionsSheetTarget): void => {
    if (!next.conversationId || !next.messageId) return;
    dismissRegisteredComposerFocus();
    Keyboard.dismiss();
    void KeyboardController.dismiss();
    setTarget(next);
  }, []);

  const contextValue = useMemo<ReactionsSheetContextValue>(
    () => ({ openReactions }),
    [openReactions],
  );

  const handleClose = useCallback((open: boolean): void => {
    if (!open) setTarget(null);
  }, []);

  return (
    <ReactionsSheetContext.Provider value={contextValue}>
      {children}
      <ReactionsSheetContent
        target={target}
        getConversationById={getConversationById}
        currentUser={currentUser}
        onOpenChange={handleClose}
      />
    </ReactionsSheetContext.Provider>
  );
};

type ReactionsSheetContentProps = {
  target: ReactionsSheetTarget | null;
  getConversationById: (conversationId: string) => ConversationItem | undefined;
  currentUser: User | undefined;
  onOpenChange: (open: boolean) => void;
};

const ReactionsSheetContent = ({
  target,
  getConversationById,
  currentUser,
  onOpenChange,
}: ReactionsSheetContentProps): ReactElement | null => {
  const users = useUsers();
  const zero = useZero();
  const { user } = useAuth();
  const currentUserId = currentUser?.id ?? user?.user_id;

  const messageId = target?.messageId;

  const reactionsMd = useMemo<string | null>(() => {
    if (!target) return null;
    const conversation = getConversationById(target.conversationId);
    return getConversationReactionsMd(conversation);
  }, [target, getConversationById]);

  const raw = useMemo<RawReaction[]>(() => {
    if (!messageId) return [];
    if (reactionsMd === null && target?.fallbackReactions) {
      return target.fallbackReactions;
    }
    return reactionsMdToRawReactions(reactionsMd, messageId);
  }, [messageId, reactionsMd, target?.fallbackReactions]);

  const groups = useMemo(() => groupReactionsForPill(raw), [raw]);
  const total = totalReactionCount(raw);

  const rows = useMemo<ReactionRow[]>(() => {
    return [...raw]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(r => {
        const isSelf = !!currentUserId && r.userId === currentUserId;
        const orgUser = users.find(u => u.id === r.userId);
        return {
          reactionId: r.reactionId,
          userId: r.userId,
          name: isSelf ? 'You' : (orgUser?.name ?? 'Unknown'),
          picture: orgUser?.picture ?? '',
          emojiName: r.emojiName,
          createdAt: r.createdAt,
        };
      });
  }, [raw, users, currentUserId]);

  const handleRemoveReaction = useCallback(
    (emojiName: string): void => {
      if (!target || !messageId || !currentUserId) return;
      void zero.mutate(
        mutators.messages.react({
          messageId,
          emojiName,
          action: 'remove',
          timestamp: Date.now(),
        }),
      );
    },
    [currentUserId, messageId, target, zero],
  );

  // Only mount the sheet once there is something to show. Keeping it unmounted
  // otherwise avoids a stray empty drawer if a tap races ahead of data.
  if (!target || groups.length === 0) return null;

  return (
    <ReactionsBottomSheet
      isOpen
      onOpenChange={onOpenChange}
      rows={rows}
      groups={groups}
      total={total}
      currentUserId={currentUserId}
      onRemoveReaction={handleRemoveReaction}
    />
  );
};
