import { type ReactElement, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileEdit, Trash2, Send, Clock, Pencil, X } from 'lucide-react';
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
import { Button } from '../../ui/Button/Button';
import { MessageCard, RecipientAvatar, useRecipientName } from '../MessageCard';
import { ScheduleMessageDialog } from '../../ui/ScheduleMessageDialog/ScheduleMessageDialog';

type DraftWithAttachments = DraftMessageDB & {
  attachments?: readonly MessageAttachment[] | undefined;
};

const DraftRow = ({ draft }: { draft: DraftWithAttachments }): ReactElement => {
  const zero = useZero();
  const navigate = useNavigate();
  const { clearDroppedFiles } = useDraftAttachments();
  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<'delete' | 'send' | null>(null);

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

  // avatarHelpers only access conversation?.channelId, so a partial object is safe
  const channelRef = { channelId: draft.channelId } as Conversation;
  const recipientName = useRecipientName(null, channelRef);
  const displayName = draft.conversationId ? `${recipientName} · thread` : recipientName;

  const performDelete = (): void => {
    try {
      const lookupId = draft.conversationId ?? draft.channelId;
      removeDraft(lookupId);
      void clearDroppedFiles(draft.channelId, draft.conversationId);
      void zero.mutate(mutators.draftMessages.delete({ id: draft.id }));
      setConfirmDialog(null);
      toast.success('Draft deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete draft');
    }
  };

  const performSend = (): void => {
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
        recipientAvatar={<RecipientAvatar conversation={channelRef} />}
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
            if (!open) setConfirmDialog(null);
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
                className='rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0'
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
                className='text-sm font-medium px-4 py-2 rounded-md border border-border bg-background text-foreground hover:bg-muted/60 transition-colors'
                data-track-category='DRAFTS_PANEL'
                data-track-name='cancel-delete-draft'
              >
                Cancel
              </button>
              <Button
                variant='ghost'
                type='button'
                onClick={() => void performDelete()}
                className='text-sm font-bold px-4 py-2 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors'
                data-track-category='DRAFTS_PANEL'
                data-track-name='confirm-delete-draft'
                trackId='delete_draft'
              >
                Delete Draft
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {confirmDialog === 'send' && (
        <Dialog
          open
          onOpenChange={open => {
            if (!open) setConfirmDialog(null);
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
                className='rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0'
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
                className='text-sm font-medium px-4 py-2 rounded-md border border-border bg-background text-foreground hover:bg-muted/60 transition-colors'
                data-track-category='DRAFTS_PANEL'
                data-track-name='cancel-send-draft'
              >
                Cancel
              </button>
              <Button
                variant='ghost'
                type='button'
                onClick={() => void performSend()}
                className='text-sm font-medium px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors'
                data-track-category='DRAFTS_PANEL'
                data-track-name='confirm-send-draft'
                trackId='send_draft'
              >
                Send now
              </Button>
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
