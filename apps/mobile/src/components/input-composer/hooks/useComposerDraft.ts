import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react';
import type { ComposerAttachment } from '../input-composer.types';
import {
  composerHtmlToPlainText,
  composerNativeSetValue,
  shouldWriteComposerNativeValue,
} from '../utils/conversation-input.utils';
import {
  zeroDraftAttachmentsToComposerAttachments,
  type ZeroDraftAttachment,
} from '../utils/zero-draft-attachments';
import { prepareDraftComposerContent } from '@/src/utils/prepareEditComposerContent';
import {
  clearDraft,
  findZeroDraftForComposer,
  getDraft,
  isDraftCleared,
  isDraftEmpty,
  setDraft,
  shouldClearLocalDraftForRemoteDelete,
} from '../utils/drafts';
import type { ComposerSnapshot } from '../input-composer.types';
import { useQuery } from '@/src/hooks/useQuery';
import { queries } from '@/src/zero/queries';

type UseComposerDraftParams = {
  draftId: string;
  channelId: string;
  threadId: string | undefined;
  suppressDraftSync: boolean;
  suppressDraftSyncRef: MutableRefObject<boolean>;
  htmlRef: MutableRefObject<string>;
  textRef: MutableRefObject<string>;
  attachmentsRef: MutableRefObject<ComposerAttachment[]>;
  setAttachmentsState: (attachments: ComposerAttachment[]) => void;
  setAlsoSendToChannelState: (enabled: boolean) => void;
  syncInputValue: (value: string) => void;
  syncSendUi: () => void;
  resetComposerAndInput: (
    nextText?: string,
    nextHtml?: string,
    options?: { skipInputSync?: boolean; skipAttachmentReset?: boolean },
  ) => void;
};

type UseComposerDraftReturn = {
  restoreDraftComposer: () => void;
  restoreComposerSnapshot: (snapshot: ComposerSnapshot) => void;
  markComposerDraftDirty: () => void;
};

export function useComposerDraft({
  draftId,
  channelId,
  threadId,
  suppressDraftSync,
  suppressDraftSyncRef,
  htmlRef,
  textRef,
  attachmentsRef,
  setAttachmentsState,
  setAlsoSendToChannelState,
  syncInputValue,
  syncSendUi,
  resetComposerAndInput,
}: UseComposerDraftParams): UseComposerDraftReturn {
  const hydrationSeqRef = useRef(0);
  const appliedRemoteRowIdRef = useRef<string | null>(null);
  const composerDirtyRef = useRef(false);
  const [zeroDrafts, zeroDraftsDetails] = useQuery(queries.userDrafts());

  const markComposerDraftDirty = useCallback((): void => {
    composerDirtyRef.current = true;
  }, []);

  const paintNativeValue = useCallback(
    (text: string, html: string, previousNative?: string): string => {
      const nextNative = composerNativeSetValue(text, html);
      if (shouldWriteComposerNativeValue(nextNative, previousNative)) {
        syncInputValue(nextNative);
      }
      return nextNative;
    },
    [syncInputValue],
  );

  const hydrateAndApplyDraftContent = useCallback(
    (
      text: string,
      html: string,
      options?: { persistDraft?: boolean; resetComposer?: boolean },
    ): void => {
      const hydrationSeq = ++hydrationSeqRef.current;

      if (options?.resetComposer !== false) {
        resetComposerAndInput(text, html, { skipInputSync: true, skipAttachmentReset: true });
      } else {
        textRef.current = text;
        htmlRef.current = html;
      }
      const paintedNative = paintNativeValue(text, html);

      void prepareDraftComposerContent(text, html).then(
        ({ text: hydratedText, html: hydratedHtml }) => {
          if (hydrationSeq !== hydrationSeqRef.current) return;
          textRef.current = hydratedText;
          htmlRef.current = hydratedHtml;
          if (options?.persistDraft !== false && !suppressDraftSyncRef.current) {
            setDraft(draftId, { text: hydratedText, html: hydratedHtml });
          }
          paintNativeValue(hydratedText, hydratedHtml, paintedNative);
          syncSendUi();
        },
      );
    },
    [
      draftId,
      htmlRef,
      paintNativeValue,
      resetComposerAndInput,
      suppressDraftSyncRef,
      syncSendUi,
      textRef,
    ],
  );

  const restoreDraftComposer = useCallback((): void => {
    const { text: nextText, html: nextHtml } = getDraft(draftId);
    hydrateAndApplyDraftContent(nextText, nextHtml);
  }, [draftId, hydrateAndApplyDraftContent]);

  const restoreComposerSnapshot = useCallback(
    (snapshot: ComposerSnapshot): void => {
      setAttachmentsState(snapshot.attachments);
      setAlsoSendToChannelState(snapshot.alsoSendToChannel);
      // Append the failed send to whatever the user has typed since. This
      // mirrors dashboard's "restored as draft" behaviour: existing content is
      // kept and the retry candidate is added on top, so nothing is lost even
      // if the user started composing a new message while the send was in
      // flight.
      const currentText = textRef.current;
      const currentHtml = htmlRef.current;
      const mergedText =
        currentText.length > 0 ? `${snapshot.text}\n${currentText}` : snapshot.text;
      const mergedHtml =
        currentHtml.length > 0 && currentHtml !== '<p></p>'
          ? `${snapshot.html}${currentHtml}`
          : snapshot.html;
      hydrateAndApplyDraftContent(mergedText, mergedHtml, {
        persistDraft: false,
        resetComposer: false,
      });
    },
    [htmlRef, hydrateAndApplyDraftContent, setAlsoSendToChannelState, setAttachmentsState, textRef],
  );

  // Restore the thread draft synchronously before paint when leaving edit mode
  // so reply-only UI (e.g. also-send-to-channel) does not flash stale content.
  useLayoutEffect(() => {
    if (suppressDraftSync) return;

    const hydrationSeq = ++hydrationSeqRef.current;
    const currentDraftId = draftId;
    const { text: nextText, html: nextHtml } = getDraft(currentDraftId);

    resetComposerAndInput(nextText, nextHtml, { skipInputSync: true });
    const paintedNative = paintNativeValue(nextText, nextHtml);

    void prepareDraftComposerContent(nextText, nextHtml).then(({ text, html }) => {
      if (hydrationSeq !== hydrationSeqRef.current) return;
      textRef.current = text;
      htmlRef.current = html;
      if (!suppressDraftSyncRef.current && !isDraftEmpty({ text, html })) {
        setDraft(currentDraftId, { text, html });
      }
      paintNativeValue(text, html, paintedNative);
      syncSendUi();
    });
  }, [
    draftId,
    htmlRef,
    paintNativeValue,
    resetComposerAndInput,
    suppressDraftSync,
    suppressDraftSyncRef,
    syncSendUi,
    textRef,
  ]);

  useEffect(() => {
    composerDirtyRef.current = false;
    appliedRemoteRowIdRef.current = null;
  }, [draftId]);

  useEffect(() => {
    if (suppressDraftSyncRef.current || !channelId) return;

    const row = findZeroDraftForComposer(zeroDrafts ?? [], channelId, threadId);
    const localDraft = getDraft(draftId);
    const composerDraft = { text: textRef.current, html: htmlRef.current };
    const localEmpty = isDraftEmpty(localDraft) && isDraftEmpty(composerDraft);
    const remoteAttachments = zeroDraftAttachmentsToComposerAttachments(
      row?.attachments as readonly ZeroDraftAttachment[] | undefined,
    );
    const hasRemoteDraft = Boolean(
      row && (row.content?.trim() || remoteAttachments.length > 0 || row.hasAttachment),
    );

    if (hasRemoteDraft && row) {
      if (
        !composerDirtyRef.current &&
        attachmentsRef.current.length === 0 &&
        remoteAttachments.length > 0
      ) {
        setAttachmentsState(remoteAttachments);
        syncSendUi();
      }
      if (composerDirtyRef.current || !localEmpty) return;
      if (appliedRemoteRowIdRef.current === (row.id ?? row.content)) return;
      if (isDraftCleared(draftId) && remoteAttachments.length === 0) return;
      if (!row.content?.trim()) return;
      appliedRemoteRowIdRef.current = row.id ?? row.content;
      hydrateAndApplyDraftContent(composerHtmlToPlainText(row.content), row.content, {
        persistDraft: true,
      });
      if (remoteAttachments.length > 0) {
        setAttachmentsState(remoteAttachments);
      }
      return;
    }

    if (
      !shouldClearLocalDraftForRemoteDelete({
        remoteQueryComplete: zeroDraftsDetails.type === 'complete',
        hasRemoteDraft: false,
        composerDirty: composerDirtyRef.current,
        localEmpty,
        hasAppliedRemoteDraft: appliedRemoteRowIdRef.current !== null,
      })
    ) {
      return;
    }

    hydrationSeqRef.current += 1;
    appliedRemoteRowIdRef.current = null;
    clearDraft(draftId);
    textRef.current = '';
    htmlRef.current = '';
    resetComposerAndInput('', '', { skipInputSync: true });
    syncInputValue('');
    syncSendUi();
  }, [
    channelId,
    draftId,
    hydrateAndApplyDraftContent,
    htmlRef,
    resetComposerAndInput,
    setAttachmentsState,
    suppressDraftSyncRef,
    syncInputValue,
    syncSendUi,
    textRef,
    threadId,
    zeroDrafts,
    zeroDraftsDetails.type,
  ]);

  return { restoreDraftComposer, restoreComposerSnapshot, markComposerDraftDirty };
}
