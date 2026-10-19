import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { EnrichedTextInputInstance, OnChangeStateEvent } from 'react-native-enriched';
import { useZeroOfflineState } from '@xyne/shared/hooks';
import { v4 as uuidv4 } from 'uuid';

import { getEditComposerInitialContent } from '@/src/utils/prepareEditComposerContent';
import { buildComposerContentForSend } from '@/src/utils/prepareComposerContentForSend';
import { haptics } from '@/src/utils/haptics';
import { useZero } from '@/src/hooks/useZero';
import { mutators } from '@/src/zero/mutators';

import {
  ChatInputActionsContext,
  ChatInputConversationContext,
  ChatInputComposerStateContext,
  ChatInputHandlersContext,
  ChatInputMentionStateContext,
  ChatInputPanelStateContext,
  ChatInputRichStateContext,
  ChatInputTextContext,
} from './input-composer-context';
import type {
  ChatInputActions,
  ChatInputConversation,
  ChatInputComposerState,
  ChatInputHandlers,
  ChatInputLinkModalState,
  ChatInputMentionState,
  ChatInputPanelState,
  ChatInputRichState,
  ChatInputRootProps,
  ChatInputSelection,
  ChatInputSendHandler,
  ChatInputSendPayload,
  ChatInputText,
  ComposerSnapshot,
  ComposerAttachment,
  TwinEditComposerSession,
} from './input-composer.types';
import type { EmojiPickerSelection } from '@/src/components/emoji-picker';
import { isUploadedAttachment } from './input-composer-attachment-helpers';
import {
  caretFromSelection,
  insertComposerEmoji,
  type ComposerCaret,
} from './utils/insert-composer-emoji';
import { transformComposerCustomEmojiHtmlForSend } from '@/src/utils/customEmoji';
import { useLatestRef } from './utils/use-latest-ref';
import { getDraft } from './utils/drafts';
import {
  composerNativeSetValue,
  composerHtmlToPlainText,
  evaluateComposerSendUi,
  readSendableComposerText,
  resetComposerSendableText,
  shouldAttemptComposerSend,
  type ComposerSendableTextState,
} from './utils/conversation-input.utils';
import { useComposerFocusManager } from './hooks/useComposerFocusManager';
import { useComposerEditBaseline } from './hooks/useComposerEditBaseline';
import { useComposerDraft } from './hooks/useComposerDraft';
import { useComposerDraftPersistence } from './hooks/useComposerDraftPersistence';
import { registerComposerFocusDismissHandler } from '@/src/utils/composerFocusDismissRegistry';

const EMPTY_ATTACHMENTS: ComposerAttachment[] = [];
const DEFAULT_MENTION_MODE: '@' | '#' = '@';
const EMPTY_LINK_MODAL: ChatInputLinkModalState = {
  text: '',
  url: '',
  selection: null,
};

const RootComponent = ({
  conversationId,
  threadId,
  onSend,
  children,
  placeholder = 'Message',
  suppressDraftSync = false,
  editingMessage = null,
  onCancelEdit,
  attachments: externalAttachments,
}: ChatInputRootProps): ReactElement => {
  const zero = useZero();
  const { isOffline } = useZeroOfflineState();
  const isOfflineRef = useLatestRef(isOffline);
  const draftId = threadId ? `${conversationId}:${threadId}` : conversationId;
  const isEditing = editingMessage !== null;
  const isEditingRef = useLatestRef(isEditing);
  const [isTwinEditing, setIsTwinEditing] = useState(false);
  const isTwinEditingRef = useRef(false);
  const [twinEditPlaceholder, setTwinEditPlaceholder] = useState<string | null>(null);
  const twinEditSnapshotRef = useRef<{ text: string; html: string } | null>(null);
  const twinEditApproveRef = useRef<TwinEditComposerSession['onApprove'] | null>(null);

  const editInitialContent = useMemo(() => {
    if (!editingMessage) return null;
    return getEditComposerInitialContent(editingMessage.content);
  }, [editingMessage]);

  const initialAttachments = externalAttachments ?? EMPTY_ATTACHMENTS;

  const resolveInitialText = (): string => {
    if (editInitialContent) return editInitialContent.text;
    if (suppressDraftSync) return '';
    const { text: draftText } = getDraft(draftId);
    return draftText.length > 0 ? draftText : '';
  };

  const resolveInitialHtml = (): string => {
    if (editInitialContent) return editInitialContent.html;
    if (suppressDraftSync) return '';
    return getDraft(draftId).html;
  };

  // Text lives in a ref so keystrokes do not re-render Root / Input.
  const textRef = useRef<string>(resolveInitialText());
  const htmlRef = useRef(resolveInitialHtml());
  // Once onChangeText (or any setText) asserts a value — including empty —
  // that plain text is authoritative. Stale HTML must not re-enable send.
  const plainTextSyncedRef = useRef(false);

  const [attachments, setAttachmentsState] = useState<ComposerAttachment[]>(initialAttachments);
  const isSendingRef = useRef(false);
  const [isSending, setIsSendingState] = useState(false);
  const setIsSending = useCallback((next: boolean): void => {
    isSendingRef.current = next;
    setIsSendingState(next);
  }, []);
  const [sendUi, setSendUi] = useState<ChatInputText>(() =>
    evaluateComposerSendUi(
      {
        text: textRef.current,
        html: htmlRef.current,
        plainTextSynced: plainTextSyncedRef.current,
      },
      initialAttachments,
      false,
      false,
    ),
  );

  // Smarter mutation tracking: ref for the counter (no re-renders on intermediate
  // increments), state only for the boolean transition (0→1 and N→0).
  const mutationCountRef = useRef(0);
  const [isMutatingAttachments, setIsMutatingAttachments] = useState(false);

  // --- Footer & panels (ephemeral UI) ---
  const [isFormattingVisible, setIsFormattingVisibleState] = useState(false);
  const [isEmojiPickerOpen, setIsEmojiPickerOpenState] = useState(false);
  const [isAttachSheetOpen, setIsAttachSheetOpenState] = useState(false);
  const [alsoSendToChannel, setAlsoSendToChannelState] = useState(false);
  const [isInputFocused, setIsInputFocusedState] = useState(false);
  const [isLinkModalOpen, setIsLinkModalOpenState] = useState(false);
  const [linkModal, setLinkModal] = useState<ChatInputLinkModalState>(EMPTY_LINK_MODAL);

  // --- Mention state (isolated — changes on every mention keystroke) ---
  const [isMentionOpen, setIsMentionOpenState] = useState(false);
  const [mentionMode, setMentionModeState] = useState<'@' | '#'>(DEFAULT_MENTION_MODE);
  const [mentionQuery, setMentionQueryState] = useState('');

  // --- Rich input (formatting toolbar / selection) ---
  const [styleState, setStyleStateValue] = useState<OnChangeStateEvent | null>(null);
  const [selection, setSelectionValue] = useState<ChatInputSelection | null>(null);
  const selectionRef = useRef<ChatInputSelection | null>(null);
  const emojiInsertCaretRef = useRef<ComposerCaret | null>(null);

  const setSelection = useCallback((next: ChatInputSelection | null): void => {
    selectionRef.current = next;
    setSelectionValue(next);
  }, []);

  const inputRef = useRef<EnrichedTextInputInstance | null>(null);
  const isInputFocusedRef = useRef(false);
  const panelStateRef = useRef({
    isFormattingVisible: false,
    isEmojiPickerOpen: false,
    isAttachSheetOpen: false,
    isMentionOpen: false,
    isLinkModalOpen: false,
  });
  const onSendRef = useLatestRef(onSend);
  const overrideSendRef = useRef<ChatInputSendHandler | null>(null);
  const openScheduleRef = useRef<(() => void) | null>(null);
  const suppressDraftSyncRef = useRef(suppressDraftSync);
  suppressDraftSyncRef.current = suppressDraftSync || isTwinEditingRef.current;
  const alsoSendToChannelRef = useLatestRef(alsoSendToChannel);
  const attachmentsRef = useLatestRef(attachments);
  const isMutatingAttachmentsRef = useLatestRef(isMutatingAttachments);

  const currentSendableState = (): ComposerSendableTextState => ({
    text: textRef.current,
    html: htmlRef.current,
    plainTextSynced: plainTextSyncedRef.current,
  });

  const syncSendUi = useCallback((): void => {
    const nextSendUi = evaluateComposerSendUi(
      currentSendableState(),
      attachmentsRef.current,
      isSendingRef.current,
      isMutatingAttachmentsRef.current,
    );
    setSendUi(prev =>
      prev.hasComposerContent === nextSendUi.hasComposerContent &&
      prev.canSend === nextSendUi.canSend
        ? prev
        : nextSendUi,
    );
  }, [attachmentsRef, isMutatingAttachmentsRef, isSendingRef]);

  const syncInputValue = useCallback((value: string): void => {
    queueMicrotask(() => {
      inputRef.current?.setValue(value);
    });
  }, []);

  const markComposerDraftDirtyRef = useRef(() => {});

  const { scheduleDraftPersist, flushDraftPersist, clearPersistedDraft } =
    useComposerDraftPersistence({
      draftId,
      channelId: conversationId,
      threadId: threadId || undefined,
      suppressDraftSyncRef,
      textRef,
      htmlRef,
      attachmentsRef,
      onUserEdit: () => {
        markComposerDraftDirtyRef.current();
      },
    });

  // --- Focus manager (deferred selection-then-focus after native setValue) ---
  const {
    scheduleFocusAtEnd,
    notifyComposerNativeTextChange,
    notifyUserSelectionChange,
    clearScheduledFocus,
  } = useComposerFocusManager(inputRef, textRef);

  const resetUiState = useCallback((): void => {
    setIsFormattingVisibleState(false);
    setIsEmojiPickerOpenState(false);
    setIsMentionOpenState(false);
    setMentionModeState(DEFAULT_MENTION_MODE);
    setMentionQueryState('');
    setIsAttachSheetOpenState(false);
    setAlsoSendToChannelState(false);
    setIsLinkModalOpenState(false);
    setLinkModal(EMPTY_LINK_MODAL);
    setStyleStateValue(null);
    setSelection(null);
    emojiInsertCaretRef.current = null;
  }, [setSelection]);

  const setInputFocused = useCallback((focused: boolean): void => {
    isInputFocusedRef.current = focused;
    setIsInputFocusedState(focused);
  }, []);

  const dismissComposerFocus = useCallback((): void => {
    const panelState = panelStateRef.current;
    const shouldDismiss =
      isInputFocusedRef.current ||
      panelState.isFormattingVisible ||
      panelState.isEmojiPickerOpen ||
      panelState.isAttachSheetOpen ||
      panelState.isMentionOpen ||
      panelState.isLinkModalOpen;

    clearScheduledFocus();

    if (!shouldDismiss) {
      return;
    }

    inputRef.current?.blur();
    isInputFocusedRef.current = false;
    setIsInputFocusedState(false);
    resetUiState();
  }, [clearScheduledFocus, resetUiState]);

  const resetComposerAndInput = useCallback(
    (
      nextText = '',
      nextHtml = '',
      options?: { skipInputSync?: boolean; skipAttachmentReset?: boolean },
    ): void => {
      const nextSendable = resetComposerSendableText(nextText, nextHtml);
      textRef.current = nextSendable.text;
      htmlRef.current = nextSendable.html;
      plainTextSyncedRef.current = nextSendable.plainTextSynced;
      if (!options?.skipAttachmentReset) {
        setAttachmentsState(EMPTY_ATTACHMENTS);
      }
      resetUiState();
      if (!options?.skipInputSync) {
        syncInputValue(composerNativeSetValue(nextText, nextHtml));
      }
      syncSendUi();
    },
    [htmlRef, resetUiState, syncInputValue, syncSendUi],
  );

  const setText = useCallback(
    (next: string): void => {
      // Native setValue often echoes `onChangeText('')` before the Twin body
      // lands. Treating that as a real clear wipes sendable text and, if
      // Twin-edit then drops, the next Send posts an empty/user draft.
      if (
        isTwinEditingRef.current &&
        next.trim().length === 0 &&
        composerHtmlToPlainText(htmlRef.current).trim().length > 0
      ) {
        return;
      }
      textRef.current = next;
      plainTextSyncedRef.current = true;
      scheduleDraftPersist();
      syncSendUi();
    },
    [htmlRef, scheduleDraftPersist, syncSendUi],
  );

  // --- Draft management ---
  const { restoreDraftComposer, restoreComposerSnapshot, markComposerDraftDirty } =
    useComposerDraft({
      draftId,
      channelId: conversationId,
      threadId: threadId || undefined,
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
    });
  markComposerDraftDirtyRef.current = markComposerDraftDirty;

  // --- Edit baseline (mention guard + async custom emoji hydration) ---
  const { clearEditBaseline, setHtmlState: persistHtml } = useComposerEditBaseline({
    editingMessage,
    editInitialContent,
    suppressDraftSync,
    htmlRef,
    textRef,
    setTextState: setText,
    syncInputValue,
    scheduleFocusAtEnd,
    clearScheduledFocus,
    scheduleDraftPersist,
  });

  const setHtmlState = useCallback(
    (next: string): void => {
      persistHtml(next);
      syncSendUi();
    },
    [persistHtml, syncSendUi],
  );

  const rememberSelectionForEmojiInsert = useCallback((): void => {
    const end = textRef.current.length;
    emojiInsertCaretRef.current = caretFromSelection(selectionRef.current) ?? { start: end, end };
  }, [textRef]);

  const insertEmoji = useCallback(
    (emojiSelection: EmojiPickerSelection): void => {
      void (async (): Promise<void> => {
        const caret = emojiInsertCaretRef.current ?? caretFromSelection(selectionRef.current);
        let visibleEnd = textRef.current.length;
        let expectedText = textRef.current;
        try {
          const result = await insertComposerEmoji({
            inputRef,
            selection: emojiSelection,
            currentText: textRef.current,
            fallbackHtml: htmlRef.current,
            syncInputValue,
            caret,
          });
          if (result) {
            visibleEnd = result.nextText.length;
            expectedText = result.nextText;
            htmlRef.current = result.nextHtml;
            setText(result.nextText);
            setHtmlState(result.nextHtml);
          }
        } catch {
          // Keep the last known composer state if native emoji insert fails.
        }
        // Custom `setImage` already left the caret after the image. Scheduling
        // focus-at-end would yank a mid-string insert to the document end.
        if (emojiSelection.type === 'custom') {
          inputRef.current?.focus();
          return;
        }
        scheduleFocusAtEnd(visibleEnd, expectedText);
      })();
    },
    [htmlRef, inputRef, scheduleFocusAtEnd, setHtmlState, setText, syncInputValue],
  );

  const beginTwinEdit = useCallback(
    (session: TwinEditComposerSession): boolean => {
      if (isEditingRef.current) return false;
      flushDraftPersist();
      if (!twinEditSnapshotRef.current) {
        twinEditSnapshotRef.current = {
          text: textRef.current,
          html: htmlRef.current,
        };
      }
      isTwinEditingRef.current = true;
      suppressDraftSyncRef.current = true;
      setIsTwinEditing(true);
      setTwinEditPlaceholder(session.placeholder ?? 'Editing draft');
      twinEditApproveRef.current = session.onApprove;
      // Same loader as message edit — plain Twin bodies become <p>/<br> so iOS
      // keeps blank lines; TipTap HTML uses storedHtmlToComposerHtml.
      const { text: nextText, html: nextHtml } = getEditComposerInitialContent(session.message);
      resetComposerAndInput(nextText, nextHtml, { skipAttachmentReset: true });
      scheduleFocusAtEnd(nextText.length, nextText);
      return true;
    },
    [flushDraftPersist, isEditingRef, resetComposerAndInput, scheduleFocusAtEnd],
  );

  const endTwinEdit = useCallback((): void => {
    if (!isTwinEditingRef.current && !twinEditSnapshotRef.current) return;
    const snapshot = twinEditSnapshotRef.current;
    twinEditSnapshotRef.current = null;
    twinEditApproveRef.current = null;
    isTwinEditingRef.current = false;
    suppressDraftSyncRef.current = suppressDraftSync;
    setIsTwinEditing(false);
    setTwinEditPlaceholder(null);
    if (snapshot) {
      resetComposerAndInput(snapshot.text, snapshot.html, { skipAttachmentReset: true });
    }
  }, [resetComposerAndInput, suppressDraftSync]);

  const send = useCallback(async (): Promise<void> => {
    if (isSendingRef.current) return;
    if (isMutatingAttachmentsRef.current) return;

    if (isTwinEditingRef.current || twinEditApproveRef.current) {
      // Always send HTML (same shape as normal message send). Null = empty body.
      const edited = buildComposerContentForSend(textRef.current, htmlRef.current)?.trim();
      if (!edited) return;
      const approve = twinEditApproveRef.current;
      if (!approve) return;
      setIsSending(true);
      syncSendUi();
      try {
        await approve(edited);
      } finally {
        setIsSending(false);
        syncSendUi();
      }
      return;
    }

    const sendableState = currentSendableState();
    const uploadedAttachments = attachmentsRef.current.filter(isUploadedAttachment);
    if (!shouldAttemptComposerSend(sendableState, uploadedAttachments.length)) return;

    const snapshot: ComposerSnapshot = {
      text: readSendableComposerText(sendableState),
      html: sendableState.html,
      attachments: uploadedAttachments,
      alsoSendToChannel: alsoSendToChannelRef.current,
    };

    const handler = overrideSendRef.current ?? onSendRef.current;

    setIsSending(true);
    syncSendUi();
    resetComposerAndInput('', '');

    clearEditBaseline();
    if (!suppressDraftSyncRef.current) {
      clearPersistedDraft();
    }

    const payload: ChatInputSendPayload = {
      text: snapshot.text,
      html: transformComposerCustomEmojiHtmlForSend(snapshot.html, snapshot.text),
      attachments: snapshot.attachments,
      alsoSendToChannel: snapshot.alsoSendToChannel,
    };

    // The handler owns restoring the composer if the async mutation later
    // rejects — that way it can subscribe to the Zero promise callbacks
    // without blocking the send flow, and the composer commits its clear to
    // paint before restore fires.
    const restore = (): void => {
      restoreComposerSnapshot(snapshot);
    };

    try {
      await handler(payload, restore);
    } catch {
      restore();
    } finally {
      setIsSending(false);
      syncSendUi();
    }
  }, [
    attachmentsRef,
    alsoSendToChannelRef,
    clearPersistedDraft,
    clearEditBaseline,
    isMutatingAttachmentsRef,
    isSendingRef,
    onSendRef,
    resetComposerAndInput,
    restoreComposerSnapshot,
    setIsSending,
    suppressDraftSyncRef,
    syncSendUi,
  ]);

  const registerSendOverride = useCallback((handler: ChatInputSendHandler | null): void => {
    overrideSendRef.current = handler;
  }, []);

  const registerOpenSchedule = useCallback((handler: (() => void) | null): void => {
    openScheduleRef.current = handler;
  }, []);

  const openSchedule = useCallback((): void => {
    if (isEditingRef.current || isTwinEditingRef.current) return;
    if (isOfflineRef.current) {
      void haptics.warning();
      return;
    }
    if (isSendingRef.current || isMutatingAttachmentsRef.current) return;
    if (
      !shouldAttemptComposerSend(
        currentSendableState(),
        attachmentsRef.current.filter(isUploadedAttachment).length,
      )
    ) {
      return;
    }
    openScheduleRef.current?.();
  }, [attachmentsRef, isEditingRef, isMutatingAttachmentsRef, isOfflineRef, isSendingRef]);

  const confirmSchedule = useCallback(
    async (scheduledFor: number): Promise<void> => {
      if (isEditingRef.current) throw new Error('Cannot schedule while editing a message.');
      if (isTwinEditingRef.current) throw new Error('Cannot schedule while editing a twin draft.');
      if (isSendingRef.current || isMutatingAttachmentsRef.current) {
        throw new Error('Wait for the current send or upload to finish.');
      }
      if (isOfflineRef.current) {
        void haptics.warning();
        throw new Error("You're offline. Reconnect to schedule a message.");
      }

      const sendableState = currentSendableState();
      const uploadedAttachments = attachmentsRef.current.filter(isUploadedAttachment);
      if (!shouldAttemptComposerSend(sendableState, uploadedAttachments.length)) {
        throw new Error('Add a message or an attachment first.');
      }

      const snapshot: ComposerSnapshot = {
        text: readSendableComposerText(sendableState),
        html: sendableState.html,
        attachments: uploadedAttachments,
        alsoSendToChannel: alsoSendToChannelRef.current,
      };

      const content =
        buildComposerContentForSend(snapshot.text, snapshot.html) ??
        (snapshot.attachments.length > 0 ? '' : null);
      if (content === null) {
        throw new Error('Add a message or an attachment first.');
      }

      resetComposerAndInput('', '');
      if (!suppressDraftSyncRef.current) {
        clearPersistedDraft();
      }

      const threadConversationId = threadId || undefined;
      try {
        const result = await zero.mutate(
          mutators.delayedMessages.create({
            id: uuidv4(),
            channelId: conversationId,
            ...(threadConversationId ? { conversationId: threadConversationId } : {}),
            content,
            scheduledFor,
            timestamp: Date.now(),
          }),
        ).client;
        if (result.type === 'error') throw new Error(result.error.message);
      } catch (error) {
        restoreComposerSnapshot(snapshot);
        throw error;
      }
    },
    [
      alsoSendToChannelRef,
      attachmentsRef,
      clearPersistedDraft,
      conversationId,
      isEditingRef,
      isMutatingAttachmentsRef,
      isOfflineRef,
      isSendingRef,
      resetComposerAndInput,
      restoreComposerSnapshot,
      suppressDraftSyncRef,
      threadId,
      zero,
    ],
  );

  const cancelEdit = useCallback((): void => {
    clearScheduledFocus();
    clearEditBaseline();
    restoreDraftComposer();
    onCancelEdit?.();
  }, [clearEditBaseline, clearScheduledFocus, onCancelEdit, restoreDraftComposer]);

  const beginAttachmentMutation = useCallback((): void => {
    mutationCountRef.current += 1;
    if (mutationCountRef.current === 1) setIsMutatingAttachments(true);
  }, []);

  const endAttachmentMutation = useCallback((): void => {
    mutationCountRef.current = Math.max(0, mutationCountRef.current - 1);
    if (mutationCountRef.current === 0) setIsMutatingAttachments(false);
  }, []);

  const openLinkModal = useCallback((nextSelection: ChatInputSelection | null): void => {
    setLinkModal({
      text: nextSelection?.text ?? '',
      url: '',
      selection: nextSelection,
    });
    setIsLinkModalOpenState(true);
  }, []);

  const closeLinkModal = useCallback((): void => {
    setIsLinkModalOpenState(false);
  }, []);

  const setLinkModalText = useCallback((text: string): void => {
    setLinkModal(prev => ({ ...prev, text }));
  }, []);

  const setLinkModalUrl = useCallback((url: string): void => {
    setLinkModal(prev => ({ ...prev, url }));
  }, []);

  useEffect(() => {
    syncSendUi();
  }, [attachments, isSending, isMutatingAttachments, syncSendUi]);

  useEffect(() => {
    panelStateRef.current = {
      isFormattingVisible,
      isEmojiPickerOpen,
      isAttachSheetOpen,
      isMentionOpen,
      isLinkModalOpen,
    };
  }, [isAttachSheetOpen, isEmojiPickerOpen, isFormattingVisible, isLinkModalOpen, isMentionOpen]);

  const localConversation = useMemo<ChatInputConversation>(
    () => ({
      conversationId,
      threadId,
      isEditing,
      isTwinEditing,
      ...(editInitialContent ? { editDefaultValue: editInitialContent.html } : {}),
    }),
    [conversationId, threadId, isEditing, isTwinEditing, editInitialContent],
  );

  // Only changes when user explicitly opens / closes a panel.
  const localPanelState = useMemo<ChatInputPanelState>(
    () => ({
      isEmojiPickerOpen,
      isAttachSheetOpen,
      isFormattingVisible,
      isInputFocused,
      isLinkModalOpen,
      linkModal,
    }),
    [
      isAttachSheetOpen,
      isEmojiPickerOpen,
      isFormattingVisible,
      isInputFocused,
      isLinkModalOpen,
      linkModal,
    ],
  );

  // Remaining mutable state: attachments + also-send flag.
  const localComposerState = useMemo<ChatInputComposerState>(
    () => ({ alsoSendToChannel, attachments }),
    [alsoSendToChannel, attachments],
  );

  const localRichState = useMemo<ChatInputRichState>(
    () => ({ styleState, selection }),
    [styleState, selection],
  );

  const localMentionState = useMemo<ChatInputMentionState>(
    () => ({ isMentionOpen, mentionMode, mentionQuery }),
    [isMentionOpen, mentionMode, mentionQuery],
  );

  const localActions = useMemo<ChatInputActions>(
    () => ({
      setIsFormattingVisibleState,
      setIsEmojiPickerOpenState,
      setIsMentionOpenState,
      setMentionModeState,
      setMentionQueryState,
      setIsAttachSheetOpenState,
      setAlsoSendToChannelState,
      setAttachments: (next): void => {
        markComposerDraftDirtyRef.current();
        setAttachmentsState(next);
      },
      openLinkModal,
      closeLinkModal,
      setLinkModalText,
      setLinkModalUrl,
      beginAttachmentMutation,
      endAttachmentMutation,
    }),
    [
      beginAttachmentMutation,
      closeLinkModal,
      endAttachmentMutation,
      openLinkModal,
      setLinkModalText,
      setLinkModalUrl,
    ],
  );

  const resolvedPlaceholder = twinEditPlaceholder ?? placeholder;

  const localHandlers = useMemo<ChatInputHandlers>(
    () => ({
      inputRef,
      placeholder: resolvedPlaceholder,
      setInputFocused,
      setTextState: setText,
      insertEmoji,
      rememberSelectionForEmojiInsert,
      setHtmlState,
      setStyleState: setStyleStateValue,
      setSelection,
      notifyComposerNativeTextChange,
      notifyUserSelectionChange,
      flushDraftPersist,
      send,
      openSchedule,
      registerOpenSchedule,
      confirmSchedule,
      registerSendOverride,
      beginTwinEdit,
      endTwinEdit,
      onCancelEdit: cancelEdit,
    }),
    [
      beginTwinEdit,
      cancelEdit,
      confirmSchedule,
      endTwinEdit,
      flushDraftPersist,
      insertEmoji,
      notifyComposerNativeTextChange,
      notifyUserSelectionChange,
      openSchedule,
      resolvedPlaceholder,
      registerOpenSchedule,
      registerSendOverride,
      rememberSelectionForEmojiInsert,
      send,
      setInputFocused,
      setHtmlState,
      setSelection,
      setText,
    ],
  );

  useEffect(() => {
    if (externalAttachments === undefined) return;
    setAttachmentsState(externalAttachments);
  }, [externalAttachments]);

  useEffect(
    () => registerComposerFocusDismissHandler(dismissComposerFocus),
    [dismissComposerFocus],
  );

  return (
    <ChatInputConversationContext.Provider value={localConversation}>
      <ChatInputHandlersContext.Provider value={localHandlers}>
        <ChatInputActionsContext.Provider value={localActions}>
          <ChatInputPanelStateContext.Provider value={localPanelState}>
            <ChatInputComposerStateContext.Provider value={localComposerState}>
              <ChatInputTextContext.Provider value={sendUi}>
                <ChatInputRichStateContext.Provider value={localRichState}>
                  <ChatInputMentionStateContext.Provider value={localMentionState}>
                    {children}
                  </ChatInputMentionStateContext.Provider>
                </ChatInputRichStateContext.Provider>
              </ChatInputTextContext.Provider>
            </ChatInputComposerStateContext.Provider>
          </ChatInputPanelStateContext.Provider>
        </ChatInputActionsContext.Provider>
      </ChatInputHandlersContext.Provider>
    </ChatInputConversationContext.Provider>
  );
};

const Root = memo(RootComponent);
Root.displayName = 'ChatInput.Provider';

export { Root };
