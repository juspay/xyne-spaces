import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useZeroOfflineState } from '@xyne/shared/hooks';

import {
  useChatInputConversation,
  useChatInputHandlers,
} from '@/src/components/input-composer/input-composer-context';
import { useQuery } from '@/src/hooks/useQuery';
import { haptics } from '@/src/utils/haptics';
import { showMessageToast } from '@/src/utils/toast';
import { queries } from '@/src/zero/queries';

import { TwinAssistDock } from '@/src/features/drafts-sent/twin-assist-dock';
import {
  approveTwinReplyDraft,
  declineTwinReplyDraft,
  isTwinDraftDeliveryError,
  isTwinDraftGoneError,
  type TwinReplyDraftPosted,
} from '@/src/features/drafts-sent/twin-draft-api';
import {
  canEditTwinDraft,
  isTwinDockPending,
  resolveTwinSendUiTransition,
  selectTwinDraftForThread,
  shouldKeepTwinEditWhileDraftsReload,
  shouldNavigateTwinPosted,
  twinDraftsForThread,
  type TwinSendHttpOutcome,
} from '@/src/features/drafts-sent/twin-draft-assist';
import { consumeTwinDraftOpenSelection } from '@/src/features/drafts-sent/twin-draft-open';
import {
  dismissTwinDraftLocally,
  filterDismissedTwinDrafts,
  undismissTwinDraftLocally,
  useDismissedTwinDraftIds,
} from '@/src/features/drafts-sent/twin-draft-dismissed';
import { executeDraftsSentChatOpen } from '@/src/features/drafts-sent/drafts-sent-open';
import { TwinWhySheet } from '@/src/features/drafts-sent/twin-why-sheet';
import type { DraftMessageRow } from '@/src/features/drafts-sent/drafts-sent-utils';
import type { TwinReplyDraftView } from '@/src/features/drafts-sent/twin-draft-utils';
import { useComposerScheduleStripVisible } from './composer-schedule-host';

type ComposerTwinAssistHostProps = {
  children: ReactNode;
};

export function ComposerTwinAssistHost({ children }: ComposerTwinAssistHostProps): ReactElement {
  const router = useRouter();
  const { isOffline } = useZeroOfflineState();
  const {
    conversationId: channelId,
    threadId,
    isEditing,
    isTwinEditing,
  } = useChatInputConversation();
  const { beginTwinEdit, endTwinEdit } = useChatInputHandlers();
  const scheduleStripVisible = useComposerScheduleStripVisible();
  const [rawDrafts] = useQuery(queries.userDrafts());
  const [requestedDraftId, setRequestedDraftId] = useState<string | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [pendingDraftIds, setPendingDraftIds] = useState<ReadonlySet<string>>(() => new Set());
  const dismissedDraftIds = useDismissedTwinDraftIds();
  const [whyOpen, setWhyOpen] = useState(false);
  const consumedThreadRef = useRef<string | null>(null);
  const endTwinEditRef = useRef(endTwinEdit);
  endTwinEditRef.current = endTwinEdit;
  const editingDraftIdRef = useRef(editingDraftId);
  editingDraftIdRef.current = editingDraftId;
  const sendTwinDraftRef = useRef<(view: TwinReplyDraftView, editedText?: string) => Promise<void>>(
    async () => undefined,
  );
  const dockPending = isTwinDockPending(pendingDraftIds);

  const threadConversationId = threadId?.trim() || '';
  const drafts = useMemo(
    () =>
      filterDismissedTwinDrafts(
        twinDraftsForThread((rawDrafts ?? []) as DraftMessageRow[], threadConversationId),
        dismissedDraftIds,
      ),
    [dismissedDraftIds, rawDrafts, threadConversationId],
  );

  useEffect(() => {
    if (!threadConversationId) return;
    if (consumedThreadRef.current === threadConversationId) return;
    consumedThreadRef.current = threadConversationId;
    const pendingId = consumeTwinDraftOpenSelection(threadConversationId);
    if (pendingId) setRequestedDraftId(pendingId);
  }, [threadConversationId]);

  const selected = useMemo(
    () => selectTwinDraftForThread(drafts, requestedDraftId ?? editingDraftId),
    [drafts, editingDraftId, requestedDraftId],
  );

  useEffect(() => {
    if (selected && requestedDraftId && selected.id !== requestedDraftId) {
      setRequestedDraftId(selected.id);
    }
  }, [requestedDraftId, selected]);

  useEffect(() => {
    if (!editingDraftId) return;
    // Optimistic hide mid-Send: draft is filtered out but twin-edit text must stay.
    if (dismissedDraftIds.has(editingDraftId)) return;
    if (shouldKeepTwinEditWhileDraftsReload(editingDraftId, drafts)) return;
    endTwinEditRef.current();
    setEditingDraftId(null);
  }, [dismissedDraftIds, drafts, editingDraftId]);

  const navigatePosted = useCallback(
    (posted: TwinReplyDraftPosted | undefined): void => {
      if (!posted) return;
      if (!shouldNavigateTwinPosted({ channelId, conversationId: threadConversationId }, posted)) {
        return;
      }
      executeDraftsSentChatOpen(router, {
        channelId: posted.channelId,
        conversationId: posted.conversationId,
        isThreadReply: true,
        openStartedAtMs: Date.now(),
      });
    },
    [channelId, router, threadConversationId],
  );

  const runPending = useCallback(
    async (draftId: string, work: () => Promise<void>): Promise<void> => {
      setPendingDraftIds(current => {
        const next = new Set(current);
        next.add(draftId);
        return next;
      });
      try {
        await work();
      } finally {
        setPendingDraftIds(current => {
          if (!current.has(draftId)) return current;
          const next = new Set(current);
          next.delete(draftId);
          return next;
        });
      }
    },
    [],
  );

  const undismissTwinDraft = useCallback((draftId: string): void => {
    undismissTwinDraftLocally(draftId);
    setRequestedDraftId(draftId);
  }, []);

  /**
   * Optimistic UI hide while HTTP runs. Zero still owns the row until sync.
   * Pass `preserveTwinEdit` when Send came from twin-edit so a 502 can keep
   * the edited composer text (doc: keep draft + twin-edit text on retry).
   */
  const hideTwinDraftUi = useCallback(
    (draftId: string, options?: { preserveTwinEdit?: boolean }): void => {
      dismissTwinDraftLocally(draftId);
      if (!options?.preserveTwinEdit) {
        endTwinEditRef.current();
        setEditingDraftId(null);
      }
      setRequestedDraftId(current => (current === draftId ? null : current));
      setWhyOpen(false);
    },
    [],
  );

  const applyTwinSendUiTransition = useCallback(
    (draftId: string, transition: ReturnType<typeof resolveTwinSendUiTransition>): void => {
      if (transition.endTwinEdit) {
        endTwinEditRef.current();
        setEditingDraftId(null);
      }
      if (transition.undismiss) {
        undismissTwinDraft(draftId);
      }
      if (transition.restoreEditingDraftId) {
        setEditingDraftId(draftId);
      }
    },
    [undismissTwinDraft],
  );

  const settleTwinSendUi = useCallback(
    (draftId: string, preserveTwinEdit: boolean, outcome: TwinSendHttpOutcome): void => {
      applyTwinSendUiTransition(
        draftId,
        resolveTwinSendUiTransition({
          preserveTwinEdit,
          editingDraftId: editingDraftIdRef.current,
          draftId,
          outcome,
        }),
      );
    },
    [applyTwinSendUiTransition],
  );

  const sendTwinDraft = useCallback(
    async (view: TwinReplyDraftView, editedText?: string): Promise<void> => {
      const message = (editedText ?? view.message)?.trim();
      if (editedText !== undefined && !message) return;
      if (dockPending) return;
      if (isOffline) {
        void haptics.warning();
        showMessageToast("You're offline. Reconnect to send.", 'warning');
        return;
      }
      // Twin-edit Send: keep composer session until HTTP succeeds or 404.
      const preserveTwinEdit = editedText !== undefined;
      // Own this send's twin-edit id eagerly — React state can lag the approve
      // callback, and a null editingDraftId must not skip teardown.
      if (preserveTwinEdit) {
        editingDraftIdRef.current = view.id;
        setEditingDraftId(view.id);
      }
      await runPending(view.id, async () => {
        hideTwinDraftUi(view.id, { preserveTwinEdit });
        try {
          const result = await approveTwinReplyDraft(view.id, message, view.message);
          // Same cleanup for edit-send vs dock send (success and 404 share this).
          settleTwinSendUi(view.id, preserveTwinEdit, 'success');
          void haptics.success();
          // Navigation must not undismiss — approve already succeeded.
          try {
            navigatePosted(result.posted);
          } catch {
            // Cross-thread open can throw; draft stays dismissed.
          }
        } catch (error) {
          if (isTwinDraftGoneError(error)) {
            settleTwinSendUi(view.id, preserveTwinEdit, 'gone');
            showMessageToast('This draft is no longer available.', 'warning');
            return;
          }
          settleTwinSendUi(
            view.id,
            preserveTwinEdit,
            isTwinDraftDeliveryError(error) ? 'delivery_error' : 'error',
          );
          if (isTwinDraftDeliveryError(error)) {
            showMessageToast(
              editedText
                ? 'Your edit was kept — try again.'
                : 'Could not send this draft — try again.',
              'error',
            );
            return;
          }
          showMessageToast('Could not send this draft.', 'error');
        }
      });
    },
    [dockPending, hideTwinDraftUi, isOffline, navigatePosted, runPending, settleTwinSendUi],
  );
  sendTwinDraftRef.current = sendTwinDraft;

  const handleReject = useCallback(
    (view: TwinReplyDraftView): void => {
      if (dockPending) return;
      if (isOffline) {
        void haptics.warning();
        showMessageToast("You're offline. Reconnect to reject.", 'warning');
        return;
      }
      void runPending(view.id, async () => {
        hideTwinDraftUi(view.id);
        try {
          await declineTwinReplyDraft(view.id);
          void haptics.success();
        } catch (error) {
          if (isTwinDraftGoneError(error)) {
            showMessageToast('This draft is no longer available.', 'warning');
            return;
          }
          undismissTwinDraft(view.id);
          showMessageToast('Could not reject this draft.', 'error');
        }
      });
    },
    [dockPending, hideTwinDraftUi, isOffline, runPending, undismissTwinDraft],
  );

  const handleEdit = useCallback(
    (view: TwinReplyDraftView): void => {
      if (dockPending || isEditing || !canEditTwinDraft(view)) return;
      const placeholder = view.senderName
        ? `Editing draft · reply to ${view.senderName}`
        : 'Editing draft';
      // Pin editingDraftId before beginTwinEdit focuses the field so a fast
      // Send cannot race with a null editingDraftIdRef.
      editingDraftIdRef.current = view.id;
      setEditingDraftId(view.id);
      const started = beginTwinEdit({
        message: view.message ?? '',
        placeholder,
        onApprove: edited => sendTwinDraftRef.current(view, edited),
      });
      if (!started) {
        editingDraftIdRef.current = null;
        setEditingDraftId(null);
        return;
      }
      setWhyOpen(false);
    },
    [beginTwinEdit, dockPending, isEditing],
  );

  const handleBack = useCallback((): void => {
    endTwinEdit();
    setEditingDraftId(null);
  }, [endTwinEdit]);

  const handleJumpToSource = useCallback(
    (view: TwinReplyDraftView): void => {
      const messageId = view.sourceMessageId?.trim();
      if (!messageId) return;
      router.setParams({ messageId });
    },
    [router],
  );

  const showDock = Boolean(
    threadConversationId &&
    selected &&
    !isEditing &&
    // Don't surface another twin card while twin-edit Send is in flight.
    (!isTwinEditing || editingDraftId === selected.id),
  );
  const showEditChrome = Boolean(showDock && isTwinEditing && editingDraftId === selected?.id);
  const roundTop = !scheduleStripVisible;

  return (
    <>
      <View collapsable={false} className='w-full'>
        {showDock && selected ? (
          <View
            collapsable={false}
            className='w-full'
            pointerEvents='box-none'
            style={{ flexShrink: 0 }}
          >
            <TwinAssistDock
              view={selected}
              drafts={drafts}
              isEditing={showEditChrome}
              isPending={dockPending}
              roundTop={roundTop}
              onBack={handleBack}
              onSelectDraftId={setRequestedDraftId}
              {...(selected.sourceMessageId
                ? { onJumpToSource: (): void => handleJumpToSource(selected) }
                : {})}
              onWhy={() => setWhyOpen(true)}
              onReject={() => handleReject(selected)}
              onEdit={() => handleEdit(selected)}
              onSend={() => {
                void sendTwinDraft(selected);
              }}
            />
          </View>
        ) : null}
        <View collapsable={false} className='w-full' pointerEvents='auto' style={{ flexShrink: 0 }}>
          {children}
        </View>
      </View>
      {whyOpen && selected ? (
        <TwinWhySheet
          isOpen={whyOpen}
          reasoning={selected.reasoning ?? ''}
          onOpenChange={setWhyOpen}
        />
      ) : null}
    </>
  );
}
