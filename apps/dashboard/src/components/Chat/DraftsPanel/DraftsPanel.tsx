import { type ReactElement, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileEdit, Trash2, Send, Clock, Pencil, X, Loader2 } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import { toast } from 'sonner';
import { mutators } from '../../../zero/mutators';
import { useZeroWithFallback as useZero } from '../../../hooks/useZeroWithFallback';
import { useSelector } from '@xstate/react';
import { stateMachineActor, type DraftMessageDB } from '../../../machines/stateMachine';
import type { Conversation, MessageAttachment } from '@xyne/shared';
import { removeDraft, useDraftAttachments } from '../../../hooks/useDraft';
import { formatDistanceToNow } from 'date-fns';
import { Dialog } from '../../ui/Dialog/Dialog';
import { MessageCard, RecipientAvatar, useRecipientName } from '../MessageCard';
import { ScheduleMessageDialog } from '../../ui/ScheduleMessageDialog/ScheduleMessageDialog';
import { useUsersMap, useUser } from '../../../hooks/useUsers';
import type { User } from '@xyne/shared';
import UserAvatar, { AvatarSize } from '../../UserAvatar/UserAvatar';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { channelService } from '../../../services/Chat/channelService';
import { apiInstance } from '../../../services/clients/apiClient';
import { sendConversationWithAttachments } from '../AddDmForm/useExistingDmChannel';
import { flushPendingAttachmentUploads } from '../../../hooks/useComposeDmDraftAutosave';
import type { RestoreComposeDraft } from '../AddDmForm/ComposeDmPanel';
import type { UploadedFile } from '../../ui/files/Files.types';

type DraftWithAttachments = DraftMessageDB & {
  attachments?: readonly MessageAttachment[] | undefined;
};

/** Compose-DM placeholder drafts carry this channelId prefix. */
const COMPOSE_CHANNEL_PREFIX = 'composedm-';

/**
 * `composeDmRecipientIds` is stored as a comma-separated string in the DB. Split it into
 * a clean `string[]` for compose-DM drafts. Returns empty array for non-compose
 * drafts (NULL column).
 */
const getComposeDmRecipientIds = (draft: DraftWithAttachments): string[] => {
  return draft.recipientIds ? draft.recipientIds.split(',').filter(id => id.length > 0) : [];
};

const DraftRow = ({ draft }: { draft: DraftWithAttachments }): ReactElement => {
  const zero = useZero();
  const navigate = useNavigate();
  const { clearDroppedFiles } = useDraftAttachments();
  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<'delete' | 'send' | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const panelAttachments = useMemo(() => {
    const raw = draft.attachments;
    if (!raw?.length) return [];
    return raw.map(a => ({
      id: a.id,
      mimetype: a.mimetype,
      originalFilename: a.originalFilename,
      thumbnailUrl: a.thumbnailUrl,
      size: a.size,
    }));
  }, [draft.attachments]);

  // Map persisted draft attachments to the InputBox UploadedFile shape so restoring a draft
  // re-seeds atachments in InputBox.
  const restoreAttachments = useMemo<UploadedFile[]>(() => {
    const raw = draft.attachments;
    if (!raw?.length) return [];
    return raw.map(a => ({
      id: a.id,
      originalName: a.originalFilename,
      fileName: a.originalFilename,
      fileSize: a.size,
      mimeType: a.mimetype,
      fileUrl: a.url,
      ...(a.thumbnailUrl && { thumbnailUrl: a.thumbnailUrl }),
      ...(a.metadata && { metadata: a.metadata as Record<string, unknown> }),
    }));
  }, [draft.attachments]);

  const isComposeDm = draft.channelId?.startsWith(COMPOSE_CHANNEL_PREFIX) ?? false;
  const composeDmRecipientIds = useMemo(() => getComposeDmRecipientIds(draft), [draft]);
  const usersById = useUsersMap();
  const composeRecipients = useMemo(
    () =>
      isComposeDm
        ? composeDmRecipientIds.map(id => usersById.get(id)).filter((u): u is User => !!u)
        : [],
    [isComposeDm, composeDmRecipientIds, usersById],
  );
  const composeDisplayName =
    composeRecipients.length > 0
      ? composeRecipients.map(u => getUserDisplayName(u)).join(', ')
      : 'No Destination';
  const firstRecipient = useUser(composeDmRecipientIds[0] ?? '');

  // avatarHelpers only access conversation?.channelId, so a partial object is safe
  const channelRef = { channelId: draft.channelId } as Conversation;
  const resolvedRecipientName = useRecipientName(null, channelRef);
  const displayName = isComposeDm
    ? composeDisplayName
    : draft.conversationId
      ? `${resolvedRecipientName} · thread`
      : resolvedRecipientName;

  const performDelete = async (): Promise<void> => {
    setIsDeleting(true);
    try {
      const lookupId = draft.conversationId ?? draft.channelId;
      removeDraft(lookupId);
      void clearDroppedFiles(draft.channelId, draft.conversationId);
      if (isComposeDm) {
        await flushPendingAttachmentUploads(draft.id);
        await apiInstance.delete(`/drafts/compose/${draft.id}?force=true`);
      } else {
        void zero.mutate(mutators.draftMessages.delete({ id: draft.id }));
      }
      setConfirmDialog(null);
      toast.success('Draft deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete draft');
    } finally {
      setIsDeleting(false);
    }
  };

  // Compose-DM send: there is no real channel yet, so resolve-or-create the DM channel
  // for the recipient set, send the content via the conversations API, then delete the
  // placeholder draft. Mirrors ComposeDmPanel.handleSendMessage.
  const performComposeDmSend = async (): Promise<void> => {
    if (composeDmRecipientIds.length === 0) {
      toast.error('Add at least one recipient before sending');
      setConfirmDialog(null);
      return;
    }
    setIsSending(true);
    try {
      const response = await channelService.createDm({ participantIds: composeDmRecipientIds });
      const channelId = response.id;
      // A previously-closed DM may be returned; reopen it so it surfaces in the sidebar.
      if (response.isExisting) {
        void zero.mutate(mutators.channel.reopenDm({ channelId, updatedAt: Date.now() }));
      }
      // Wait for any in-flight attachment uploads so the
      // backend's DRAFT→CHAT re-parent step finds all rows.
      await flushPendingAttachmentUploads(draft.id);

      await sendConversationWithAttachments(channelId, draft.content, [], draft.id);
      setConfirmDialog(null);
      toast.success('Message sent');
      void navigate(`/chat/dir/${channelId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setIsSending(false);
    }
  };

  const performSend = (): void => {
    if (isComposeDm) {
      void performComposeDmSend();
      return;
    }
    try {
      const lookupId = draft.conversationId ?? draft.channelId;
      removeDraft(lookupId);
      void zero.mutate(mutators.draftMessages.send({ id: draft.id, timestamp: Date.now() }));
      setConfirmDialog(null);
      toast.success('Message sent');
      void navigate(
        `/chat/dir/${draft.channelId}${draft.conversationId ? `/${draft.conversationId}` : ''}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send draft');
    }
  };

  const handleDelete = (e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmDialog('delete');
  };

  const handleSend = (e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmDialog('send');
  };

  const handleSchedule = (e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    setIsScheduleDialogOpen(true);
  };

  const handleScheduleConfirm = (scheduledFor: number): void => {
    try {
      const lookupId = draft.conversationId ?? draft.channelId;
      removeDraft(lookupId);
      void zero.mutate(
        mutators.delayedMessages.create({
          id: draft.id,
          channelId: draft.channelId,
          ...(draft.conversationId ? { conversationId: draft.conversationId } : {}),
          content: draft.content,
          scheduledFor,
          timestamp: Date.now(),
        }),
      );
      toast.success('Draft scheduled');
      void navigate(`/chat/scheduled`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to schedule draft');
    }
  };

  const handleClick = (): void => {
    if (isComposeDm) {
      const restoreDraft: RestoreComposeDraft = {
        draftId: draft.id,
        channelId: draft.channelId,
        content: draft.content,
        recipientIds: composeDmRecipientIds,
        attachments: restoreAttachments,
      };
      void navigate('/chat/search?mode=dm', {
        state: { composePanelKey: draft.id, restoreDraft },
      });
      return;
    }
    void navigate(
      `/chat/dir/${draft.channelId}${draft.conversationId ? `/${draft.conversationId}` : ''}`,
    );
  };

  const plainPreview = draft.content.replace(/<[^>]+>/g, '').trim() || '(empty draft)';
  const timestamp = formatDistanceToNow(new Date(draft.updatedAt), { addSuffix: true });

  const actions = (
    <>
      <button
        type='button'
        onClick={e => {
          e.preventDefault();
          e.stopPropagation();
          handleClick();
        }}
        className='p-1.5 rounded hover:bg-accent hover:text-foreground transition-all'
        aria-label='Edit draft'
        data-track-category='DRAFTS_PANEL'
        data-track-name='EDIT_DRAFT'
      >
        <Pencil size={14} />
      </button>
      <button
        type='button'
        onClick={handleSend}
        className='p-1.5 rounded hover:bg-primary/10 hover:text-primary transition-all'
        aria-label='Send draft'
        data-track-category='DRAFTS_PANEL'
        data-track-name='SEND_DRAFT'
      >
        <Send size={14} />
      </button>
      {!isComposeDm && (
        <button
          type='button'
          onClick={handleSchedule}
          className='p-1.5 rounded hover:bg-accent hover:text-foreground transition-all'
          aria-label='Schedule draft'
          data-track-category='DRAFTS_PANEL'
          data-track-name='SCHEDULE_DRAFT'
        >
          <Clock size={14} />
        </button>
      )}
      <button
        type='button'
        onClick={handleDelete}
        className='p-1.5 rounded hover:bg-destructive/10 hover:text-destructive transition-all'
        aria-label='Delete draft'
        data-track-category='DRAFTS_PANEL'
        data-track-name='DELETE_DRAFT'
      >
        <Trash2 size={14} />
      </button>
    </>
  );

  return (
    <div className='relative'>
      <MessageCard
        recipientAvatar={
          isComposeDm ? (
            <UserAvatar userId={firstRecipient?.id ?? null} size={AvatarSize.MD} />
          ) : (
            <RecipientAvatar conversation={channelRef} />
          )
        }
        recipientName={displayName}
        contentPreview={
          <>
            {plainPreview} <Pencil size={12} className='inline' />
          </>
        }
        timestamp={timestamp}
        actions={actions}
        className='rounded-xl'
        onClick={handleClick}
        attachments={panelAttachments}
      />

      <ScheduleMessageDialog
        open={isScheduleDialogOpen}
        onOpenChange={setIsScheduleDialogOpen}
        onConfirm={handleScheduleConfirm}
        trackCategory='DRAFTS_PANEL'
      />

      {confirmDialog === 'delete' && (
        <Dialog
          open
          onOpenChange={open => {
            if (!open && !isDeleting) setConfirmDialog(null);
          }}
          title='Delete draft?'
          description={`Are you sure you want to delete this draft to ${displayName}?`}
          className='max-w-[420px] p-0'
        >
          <div>
            <div className='flex items-start justify-between gap-3 px-5 py-4'>
              <h2 className='text-base font-semibold text-foreground leading-tight pr-2'>
                Delete draft?
              </h2>
              <button
                type='button'
                onClick={() => setConfirmDialog(null)}
                disabled={isDeleting}
                className='rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0 disabled:opacity-60'
                aria-label='Close'
                data-track-category='DRAFTS_PANEL'
                data-track-name='close-delete-draft-dialog'
              >
                <X className='size-4' />
              </button>
            </div>
            <p className='px-5 py-5 text-sm text-foreground leading-relaxed'>
              Are you sure you want to delete this draft to{' '}
              <span className='font-semibold'>{displayName}</span>?
            </p>
            <div className='flex justify-end gap-2 px-5 py-4'>
              <button
                type='button'
                onClick={() => setConfirmDialog(null)}
                disabled={isDeleting}
                className='text-sm font-medium px-4 py-2 rounded-md border border-border bg-background text-foreground hover:bg-muted/60 transition-colors disabled:opacity-60'
                data-track-category='DRAFTS_PANEL'
                data-track-name='cancel-delete-draft'
              >
                Cancel
              </button>
              <button
                type='button'
                onClick={() => void performDelete()}
                disabled={isDeleting}
                className='text-sm font-bold px-4 py-2 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2'
                data-track-category='DRAFTS_PANEL'
                data-track-name='confirm-delete-draft'
              >
                {isDeleting && <Loader2 className='size-4 animate-spin' />}
                {isDeleting ? 'Deleting…' : 'Delete Draft'}
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {confirmDialog === 'send' && (
        <Dialog
          open
          onOpenChange={open => {
            if (!open && !isSending) setConfirmDialog(null);
          }}
          title='Send now?'
          description={`Are you sure you want to send this message to ${displayName} now?`}
          className='max-w-[420px] p-0'
        >
          <div>
            <div className='flex items-start justify-between gap-3 px-5 py-4'>
              <h2 className='text-base font-semibold text-foreground leading-tight pr-2'>
                Send now?
              </h2>
              <button
                type='button'
                onClick={() => setConfirmDialog(null)}
                disabled={isSending}
                className='rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0 disabled:opacity-60'
                aria-label='Close'
                data-track-category='DRAFTS_PANEL'
                data-track-name='close-send-draft-dialog'
              >
                <X className='size-4' />
              </button>
            </div>
            <p className='px-5 py-5 text-sm text-foreground leading-relaxed'>
              Are you sure you want to send this message to{' '}
              <span className='font-semibold'>{displayName}</span> now?
            </p>
            <div className='flex justify-end gap-2 px-5 py-4 bg-muted/20'>
              <button
                type='button'
                onClick={() => setConfirmDialog(null)}
                disabled={isSending}
                className='text-sm font-medium px-4 py-2 rounded-md border border-border bg-background text-foreground hover:bg-muted/60 transition-colors disabled:opacity-60'
                data-track-category='DRAFTS_PANEL'
                data-track-name='cancel-send-draft'
              >
                Cancel
              </button>
              <button
                type='button'
                onClick={() => void performSend()}
                disabled={isSending}
                className='text-sm font-medium px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2'
                data-track-category='DRAFTS_PANEL'
                data-track-name='confirm-send-draft'
              >
                {isSending && <Loader2 className='size-4 animate-spin' />}
                {isSending ? 'Sending…' : 'Send now'}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
};

// ─── Panel ────────────────────────────────────────────────────────────────────

const DraftsPanel = (): ReactElement => {
  const draftMessages = useSelector(stateMachineActor, state => state.context.draftMessages);

  const items = useMemo(
    () => [...draftMessages].sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id)),
    [draftMessages],
  );

  return (
    <div className='flex-1 h-full flex flex-col overflow-hidden bg-background'>
      {/* Drafts List */}
      <div className='flex-1 overflow-y-auto p-6'>
        {items.length === 0 ? (
          <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
            <FileEdit className='text-muted-foreground mb-4' size={48} />
            <p className='text-muted-foreground text-lg font-medium mb-2'>No drafts</p>
            <p className='text-muted-foreground text-sm max-w-md'>
              Messages you start writing but haven&apos;t sent yet will appear here
            </p>
          </div>
        ) : (
          <Virtuoso<DraftWithAttachments>
            data={items}
            className='h-full'
            style={{ height: '100%' }}
            computeItemKey={(_, item) => item.id}
            itemContent={(_, draft) => (
              <div className='mb-4 first:mt-1.5'>
                <DraftRow draft={draft} />
              </div>
            )}
          />
        )}
      </div>
    </div>
  );
};

DraftsPanel.displayName = 'DraftsPanel';

export default DraftsPanel;
