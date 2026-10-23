import { stateMachineActor } from '@xyne/shared/machines';
import { stripHtmlTags } from '@/src/utils/htmlText';

/**
 * Thin adapter over the shared draft store in `stateMachineActor`.
 *
 * Previously an in-memory `Map<string, DraftPayload>` that vanished on reload.
 * Now every write flows through the shared state machine, which persists
 * through the platform sync-storage bridge — MMKV on Lotus (see
 * `services/registerSyncStorage.ts`), localStorage on Dashboard. Composers
 * survive an app relaunch.
 *
 * The exported API (getDraft / setDraft / clearDraft) is intentionally
 * unchanged so callers (`useComposerDraft`, `input-composer-root`,
 * `useComposerEditBaseline`, `ChatChannelScreen`, `useDmListSwipeActions`)
 * need no edits.
 */
type DraftPayload = {
  text: string;
  html: string;
};

const EMPTY_DRAFT: DraftPayload = { text: '', html: '' };

/** Lookup ids the user emptied in this session so leave-channel flush does not restore Zero. */
const clearedDraftLookupIds = new Set<string>();

export const isDraftEmpty = (draft: { text: string; html: string }): boolean => {
  if (draft.text.trim().length > 0) return false;
  const plain = stripHtmlTags(draft.html.replace(/<br\s*\/?>/gi, ''))
    .replace(/&nbsp;/gi, ' ')
    .trim();
  return plain.length === 0;
};

export const isDraftCleared = (id: string): boolean => clearedDraftLookupIds.has(id);

export const unmarkDraftCleared = (id: string): void => {
  clearedDraftLookupIds.delete(id);
};

/** Drop cached composer text when Zero has no draft and the user has not typed this visit. */
export const shouldClearLocalDraftForRemoteDelete = ({
  remoteQueryComplete,
  hasRemoteDraft,
  composerDirty,
  localEmpty,
  hasAppliedRemoteDraft,
}: {
  remoteQueryComplete: boolean;
  hasRemoteDraft: boolean;
  composerDirty: boolean;
  localEmpty: boolean;
  /** False on a fresh mount — local MMKV drafts must survive app kill before Zero flush. */
  hasAppliedRemoteDraft: boolean;
}): boolean =>
  remoteQueryComplete && !hasRemoteDraft && !composerDirty && !localEmpty && hasAppliedRemoteDraft;

/**
 * Keep the Zero row when the composer is empty only if files are still attached.
 * `hasAttachment: true` with an empty `attachments[]` is a ghost flag and must
 * not block delete — otherwise cleared text stays in Drafts.
 */
export const shouldKeepRemoteDraftAfterComposerClear = ({
  composerHasAttachments,
  remoteAttachmentCount,
}: {
  composerHasAttachments: boolean;
  remoteAttachmentCount: number;
}): boolean => composerHasAttachments || remoteAttachmentCount > 0;

/** `channel.markChannelAsViewed` throws if this row is missing or deleted. */
export const canMarkChannelAsViewed = (
  status: { isDeleted?: boolean | null } | null | undefined,
): boolean => status !== null && status !== undefined && status.isDeleted !== true;

export const findZeroDraftForComposer = <
  T extends {
    id?: string;
    channelId: string;
    conversationId: string | null;
    content: string;
    hasAttachment?: boolean | null;
    attachments?: readonly unknown[] | null;
    origin?: string | null;
  },
>(
  rows: readonly T[],
  channelId: string,
  threadId: string | undefined,
): T | undefined => {
  const isComposerDraft = (row: T): boolean =>
    row.origin === null || row.origin === undefined || row.origin === 'user';
  if (threadId) {
    return rows.find(
      row => isComposerDraft(row) && row.channelId === channelId && row.conversationId === threadId,
    );
  }
  return rows.find(
    row => isComposerDraft(row) && row.channelId === channelId && !row.conversationId,
  );
};

export const getDraft = (id: string): DraftPayload => {
  const stored = stateMachineActor.getSnapshot().context.drafts[id];
  if (!stored) return EMPTY_DRAFT;
  return { text: stored.text, html: stored.html };
};

export const getDraftFlushContent = (lookupId: string, fallback = ''): string => {
  if (clearedDraftLookupIds.has(lookupId)) return '';
  const draft = getDraft(lookupId);
  if (isDraftEmpty(draft)) return fallback;
  if (!isDraftEmpty({ text: '', html: draft.html })) return draft.html;
  return draft.text;
};

export const setDraft = (id: string, draft: DraftPayload): void => {
  if (isDraftEmpty(draft)) {
    clearedDraftLookupIds.add(id);
    stateMachineActor.send({ type: 'REMOVE_DRAFT', lookupId: id });
    return;
  }
  clearedDraftLookupIds.delete(id);
  stateMachineActor.send({
    type: 'SAVE_DRAFT',
    lookupId: id,
    text: draft.text,
    html: draft.html,
  });
};

export const clearDraft = (id: string): void => {
  clearedDraftLookupIds.add(id);
  stateMachineActor.send({ type: 'REMOVE_DRAFT', lookupId: id });
};

/** Production `draftMessages.delete` only accepts origin `user` or null. Twin throws. */
export const isRemoteUserComposerDraft = (row: {
  id?: string | null;
  origin?: string | null;
}): boolean => {
  const id = row.id?.trim();
  if (!id) return false;
  return row.origin === null || row.origin === undefined || row.origin === 'user';
};

const claimedRemoteDraftDeletes = new Set<string>();

/**
 * Returns the Zero draft id to delete at most once. A second delete for the
 * same id throws `Draft not found` on the production server.
 */
export const claimRemoteUserDraftDelete = (row: {
  id?: string | null;
  origin?: string | null;
}): string | undefined => {
  if (!isRemoteUserComposerDraft(row)) return undefined;
  const id = row.id?.trim() ?? '';
  if (!id || claimedRemoteDraftDeletes.has(id)) return undefined;
  claimedRemoteDraftDeletes.add(id);
  return id;
};
