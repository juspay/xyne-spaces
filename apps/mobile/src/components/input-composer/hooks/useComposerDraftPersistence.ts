import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { AppState } from 'react-native';

import { useQuery } from '@/src/hooks/useQuery';
import { useZero } from '@/src/hooks/useZero';
import { mutators } from '@/src/zero/mutators';
import { queries } from '@/src/zero/queries';

import type { ComposerAttachment } from '../input-composer.types';
import {
  clearDraft,
  findZeroDraftForComposer,
  isDraftEmpty,
  setDraft,
  shouldKeepRemoteDraftAfterComposerClear,
  unmarkDraftCleared,
  claimRemoteUserDraftDelete,
} from '../utils/drafts';
import {
  composerHtmlHasNativeBody,
  composerNativeSetValue,
} from '../utils/conversation-input.utils';

const DRAFT_PERSIST_DELAY_MS = 400;

type UseComposerDraftPersistenceParams = {
  draftId: string;
  channelId: string;
  threadId: string | undefined;
  suppressDraftSyncRef: MutableRefObject<boolean>;
  textRef: MutableRefObject<string>;
  htmlRef: MutableRefObject<string>;
  attachmentsRef: MutableRefObject<ComposerAttachment[]>;
  onUserEdit?: () => void;
};

type UseComposerDraftPersistenceReturn = {
  scheduleDraftPersist: () => void;
  flushDraftPersist: () => void;
  clearPersistedDraft: () => void;
};

/**
 * Owns draft writes for a mounted composer. Text and HTML update synchronously
 * in refs; persistence waits for an idle or lifecycle boundary.
 */
export function useComposerDraftPersistence({
  draftId,
  channelId,
  threadId,
  suppressDraftSyncRef,
  textRef,
  htmlRef,
  attachmentsRef,
  onUserEdit,
}: UseComposerDraftPersistenceParams): UseComposerDraftPersistenceReturn {
  const zero = useZero();
  const [zeroDrafts] = useQuery(queries.userDrafts());
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasPendingWriteRef = useRef(false);

  const flushDraftPersist = useCallback((): void => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (!hasPendingWriteRef.current) return;

    hasPendingWriteRef.current = false;
    const text = textRef.current;
    const html = htmlRef.current;
    const nextDraft = {
      text,
      html: composerHtmlHasNativeBody(html) ? html : composerNativeSetValue(text, ''),
    };
    setDraft(draftId, nextDraft);

    if (!isDraftEmpty(nextDraft) || suppressDraftSyncRef.current || !channelId) return;

    const row = findZeroDraftForComposer(zeroDrafts ?? [], channelId, threadId);
    if (
      shouldKeepRemoteDraftAfterComposerClear({
        composerHasAttachments: attachmentsRef.current.length > 0,
        remoteAttachmentCount: row?.attachments?.length ?? 0,
      })
    ) {
      unmarkDraftCleared(draftId);
      return;
    }
    if (!row) return;
    const remoteId = claimRemoteUserDraftDelete(row);
    if (!remoteId) return;
    void zero.mutate(mutators.draftMessages.delete({ id: remoteId }));
  }, [
    attachmentsRef,
    channelId,
    draftId,
    htmlRef,
    suppressDraftSyncRef,
    textRef,
    threadId,
    zero,
    zeroDrafts,
  ]);

  const scheduleDraftPersist = useCallback((): void => {
    if (suppressDraftSyncRef.current) return;

    onUserEdit?.();
    hasPendingWriteRef.current = true;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(flushDraftPersist, DRAFT_PERSIST_DELAY_MS);
  }, [flushDraftPersist, onUserEdit, suppressDraftSyncRef]);

  const clearPersistedDraft = useCallback((): void => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    hasPendingWriteRef.current = false;
    clearDraft(draftId);
  }, [draftId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        flushDraftPersist();
      }
    });

    return (): void => {
      subscription.remove();
      flushDraftPersist();
    };
  }, [flushDraftPersist]);

  return { scheduleDraftPersist, flushDraftPersist, clearPersistedDraft };
}
