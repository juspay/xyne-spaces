import { stripHtmlForPlainText } from '@/src/components/input-composer/utils/html-plain-text';

import type { DraftMessageRow } from './drafts-sent-utils';
import {
  formatTwinDestinationLabel,
  listTwinDraftViews,
  type TwinReplyDraftView,
} from './twin-draft-utils';

const looksLikeHtml = (value: string): boolean => /<[a-z][\s\S]*>/i.test(value);

/** Normalize Twin body to plain text for unchanged-edit detection (HTML or plain). */
export const twinMessagePlainText = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return looksLikeHtml(trimmed) ? stripHtmlForPlainText(trimmed).trim() : trimmed;
};

export const twinDraftsForThread = (
  rows: readonly DraftMessageRow[],
  conversationId: string,
): TwinReplyDraftView[] => {
  const trimmed = conversationId.trim();
  if (!trimmed) return [];
  return listTwinDraftViews(rows).filter(view => view.conversationId === trimmed);
};

export const selectTwinDraftForThread = (
  drafts: readonly TwinReplyDraftView[],
  requestedId?: string | null,
): TwinReplyDraftView | null => {
  if (drafts.length === 0) return null;
  if (requestedId) {
    const match = drafts.find(view => view.id === requestedId);
    if (match) return match;
  }
  return drafts[0] ?? null;
};

export const twinDraftPagerLabel = (
  drafts: readonly TwinReplyDraftView[],
  selectedId: string,
): string | null => {
  if (drafts.length < 2) return null;
  const index = drafts.findIndex(view => view.id === selectedId);
  if (index < 0) return null;
  return `${index + 1}/${drafts.length}`;
};

export const adjacentTwinDraftId = (
  drafts: readonly TwinReplyDraftView[],
  selectedId: string,
  delta: -1 | 1,
): string | null => {
  const index = drafts.findIndex(view => view.id === selectedId);
  if (index < 0) return null;
  const next = drafts[index + delta];
  return next?.id ?? null;
};

export const canEditTwinDraft = (view: TwinReplyDraftView): boolean =>
  view.action === 'reply' || view.action === 'react_and_reply';

export const formatTwinIntentLabel = (view: TwinReplyDraftView): string => {
  if (view.action === 'react') {
    return view.emoji ? `React ${view.emoji}` : 'Twin reaction';
  }
  return formatTwinDestinationLabel(view);
};

export const twinDraftBodyPreview = (view: TwinReplyDraftView): string => {
  if (view.action === 'react') {
    return view.emoji ? view.emoji : 'Twin reaction';
  }
  const message = view.message?.trim() ?? '';
  if (message.length > 0) return message;
  if (view.action === 'react_and_reply' && view.emoji) return view.emoji;
  return '(no message)';
};

export const twinDraftSendLabel = (view: TwinReplyDraftView): string =>
  view.action === 'react' ? 'Send reaction' : 'Send';

export type TwinPostedLocation = {
  channelId: string;
  conversationId: string;
};

export const shouldNavigateTwinPosted = (
  current: { channelId: string; conversationId: string },
  posted?: TwinPostedLocation,
): boolean => {
  if (!posted) return false;
  if (posted.channelId !== current.channelId) return true;
  return posted.conversationId !== current.conversationId;
};

export const buildTwinApproveBody = (
  editedMessage?: string,
  originalMessage?: string,
): Record<string, string> => {
  const trimmed = editedMessage?.trim() ?? '';
  if (!trimmed) return {};
  // Composer approve sends HTML; Twin originals are often plain. Compare plain
  // so open-edit-Send without changes does not send a spurious editedMessage.
  if (twinMessagePlainText(trimmed) === twinMessagePlainText(originalMessage ?? '')) {
    return {};
  }
  return { editedMessage: trimmed };
};

/**
 * Empty Zero snapshots are reloads, not "draft gone". Exiting Twin-edit on
 * that flicker dumps Twin text into the user composer, and the next Send
 * posts it as a normal message.
 */
export const shouldKeepTwinEditWhileDraftsReload = (
  editingDraftId: string | null,
  drafts: readonly { id: string }[],
): boolean => {
  if (!editingDraftId) return false;
  if (drafts.length === 0) return true;
  return drafts.some(draft => draft.id === editingDraftId);
};

/**
 * While any approve/reject HTTP is in flight the dock must stay locked —
 * optimistically hiding draft A surfaces draft B immediately, and B must not
 * accept edit/send/reject until A's request settles.
 */
export const isTwinDockPending = (pendingDraftIds: ReadonlySet<string>): boolean =>
  pendingDraftIds.size > 0;

/**
 * Completing draft A's request must not tear down an active twin-edit on B.
 */
export const shouldClearTwinEditOnDraftSuccess = (
  editingDraftId: string | null,
  completedDraftId: string,
): boolean => editingDraftId === completedDraftId;

/** HTTP settle outcome for twin approve/edit-send. */
export type TwinSendHttpOutcome = 'success' | 'gone' | 'delivery_error' | 'error';

/**
 * UI teardown after twin Send settles. Host applies these flags — do not
 * re-derive them inline (edit-send must end twin-edit even when
 * `editingDraftId` lagged to null).
 */
export type TwinSendUiTransition = {
  endTwinEdit: boolean;
  undismiss: boolean;
  restoreEditingDraftId: boolean;
};

export const resolveTwinSendUiTransition = (input: {
  /** True when Send came from twin-edit (`editedText !== undefined`). */
  preserveTwinEdit: boolean;
  editingDraftId: string | null;
  draftId: string;
  outcome: TwinSendHttpOutcome;
}): TwinSendUiTransition => {
  if (input.outcome === 'success' || input.outcome === 'gone') {
    return {
      // Edit-send always owns teardown; dock send only clears matching edit.
      endTwinEdit:
        input.preserveTwinEdit ||
        shouldClearTwinEditOnDraftSuccess(input.editingDraftId, input.draftId),
      undismiss: false,
      restoreEditingDraftId: false,
    };
  }

  return {
    endTwinEdit: false,
    undismiss: true,
    restoreEditingDraftId: input.preserveTwinEdit,
  };
};
