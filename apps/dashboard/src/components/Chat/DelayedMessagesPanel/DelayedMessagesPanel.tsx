import { ReactElement, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Clock, Loader2, X } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import { mutators } from '../../../zero/mutators';
import { useZeroWithFallback as useZero } from '../../../hooks/useZeroWithFallback';
import type { DelayedMessage, Conversation, MessageAttachment } from '@xyne/shared';
import { DelayedMessageStatus } from '@xyne/shared';
import { usePlatform } from '../../../hooks/usePlatform';
import { saveDraft } from '../../../hooks/useDraft';
import { format, formatDistanceToNow, isToday, isTomorrow } from 'date-fns';
import { toast } from 'sonner';
import { Dialog } from '../../ui/Dialog/Dialog';
import { DelayedMessageDropdown } from '../DelayedMessageDropdown';
import { DelayedMessageEditModal } from '../DelayedMessageDropdown/DelayedMessageEditModal';
import { MessageCard } from '../MessageCard';
import { RecipientAvatar, useRecipientName } from '../MessageCard/avatarHelpers';
import { ScheduleMessageDialog } from '../../ui/ScheduleMessageDialog/ScheduleMessageDialog';
import { useUserDelayedMessages } from '../../../hooks/useUserDelayedMessages';
import { Button } from '../../ui/Button';

type DelayedMessageWithAttachments = DelayedMessage & {
  attachments?: readonly MessageAttachment[] | undefined;
};

// ─── Single scheduled-message row ────────────────────────────────────────────

const DelayedMessageRow = ({
  delayedMessage,
  onEdit,
}: {
  delayedMessage: DelayedMessageWithAttachments;
  onEdit: (msg: DelayedMessageWithAttachments) => void;
}): ReactElement => {
  const zero = useZero();
  const navigate = useNavigate();

  const panelAttachments = useMemo(() => {
    const raw = delayedMessage.attachments;
    if (!raw?.length) return [];
    return raw.map(a => ({
      id: a.id,
      mimetype: a.mimetype,
      originalFilename: a.originalFilename,
      thumbnailUrl: a.thumbnailUrl,
      size: a.size,
    }));
  }, [delayedMessage.attachments]);

  // Build a minimal conversation-like object for avatar helpers.
  // RecipientAvatar / useRecipientName only read conversation?.channelId
  // internally, then resolve the full channel via useChannel.
  const conversationForHelpers = useMemo(
    () => ({ channelId: delayedMessage.channelId }) as unknown as Conversation,
    [delayedMessage.channelId],
  );

  const recipientName = useRecipientName(null, conversationForHelpers);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showSendNowConfirm, setShowSendNowConfirm] = useState(false);
  const [isRescheduleDialogOpen, setIsRescheduleDialogOpen] = useState(false);
  const [isSendNowLoading, setIsSendNowLoading] = useState(false);

  const handleConfirmDelete = (): void => {
    try {
      zero.mutate(
        mutators.delayedMessages.cancel({ id: delayedMessage.id, timestamp: Date.now() }),
      );
      toast.success('Message deleted');
    } catch {
      toast.error('Failed to delete message');
    } finally {
      setShowDeleteConfirm(false);
    }
  };

  const handleRescheduleClick = (): void => setIsRescheduleDialogOpen(true);

  const handleRescheduleConfirm = (scheduledFor: number): void => {
    try {
      zero.mutate(
        mutators.delayedMessages.reschedule({
          id: delayedMessage.id,
          scheduledFor,
          timestamp: Date.now(),
        }),
      );
      toast.success('Message rescheduled');
      setIsRescheduleDialogOpen(false);
    } catch {
      toast.error('Failed to reschedule message');
    }
  };

  const performSendNow = (): void => {
    setIsSendNowLoading(true);
    try {
      zero.mutate(
        mutators.delayedMessages.sendNow({
          id: delayedMessage.id,
          timestamp: Date.now(),
        }),
      );
      toast.success('Message sent');
      setShowSendNowConfirm(false);
      void navigate(
        `/chat/dir/${delayedMessage.channelId}${delayedMessage.conversationId ? `/${delayedMessage.conversationId}` : ''}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setIsSendNowLoading(false);
    }
  };

  const handleSaveToDrafts = (): void => {
    try {
      zero.mutate(
        mutators.delayedMessages.convertToDraft({
          id: delayedMessage.id,
          timestamp: Date.now(),
        }),
      );
      // Update local draft state so the ChatInput shows the converted draft immediately
      const lookupId = delayedMessage.conversationId ?? delayedMessage.channelId;
      const plainText = delayedMessage.content.replace(/<[^>]+>/g, '').trim();
      saveDraft(lookupId, delayedMessage.content, plainText);
      toast.success('Saved to drafts');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save to drafts');
    }
  };

  const plainPreview = delayedMessage.content.replace(/<[^>]+>/g, '').trim() || '(no text)';
  const scheduledDate = new Date(delayedMessage.scheduledFor);

  const displayName = delayedMessage.conversationId ? `${recipientName} · thread` : recipientName;

  const primaryScheduleText = isToday(scheduledDate)
    ? `Today, ${format(scheduledDate, 'h:mm a')}`
    : isTomorrow(scheduledDate)
      ? `Tomorrow, ${format(scheduledDate, 'h:mm a')}`
      : format(scheduledDate, 'MMM d, h:mm a');
  const relativeScheduleText = formatDistanceToNow(scheduledDate, { addSuffix: true });
  const isSoon = scheduledDate.getTime() - Date.now() < 60 * 60 * 1000;
  const timestamp = (
    <div className='flex flex-col items-end gap-1 text-right'>
      <span className='inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700'>
        <Clock className='h-3 w-3' />
        <span className='font-semibold text-foreground'>{primaryScheduleText}</span>
      </span>
      <span
        className={isSoon ? 'text-xs font-medium text-orange-600' : 'text-xs text-muted-foreground'}
      >
        {relativeScheduleText}
      </span>
    </div>
  );

  const actions = (
    <DelayedMessageDropdown
      delayedMessage={delayedMessage}
      onEdit={() => onEdit(delayedMessage)}
      onReschedule={handleRescheduleClick}
      onSendNow={() => setShowSendNowConfirm(true)}
      onSaveToDrafts={handleSaveToDrafts}
      onDelete={() => setShowDeleteConfirm(true)}
      loading={isSendNowLoading}
    />
  );

  return (
    <div className='mb-4 first:mt-1.5'>
      <MessageCard
        recipientAvatar={<RecipientAvatar conversation={conversationForHelpers} />}
        recipientName={displayName}
        contentPreview={plainPreview}
        timestamp={timestamp}
        timestampClassName='min-w-[160px]'
        timestampLayout='floating'
        actions={actions}
        className='rounded-xl'
        onClick={() => onEdit(delayedMessage)}
        trackCategory='delayed-messages'
        trackName='scheduled-message-row-open'
        attachments={panelAttachments}
      />
      <ScheduleMessageDialog
        open={isRescheduleDialogOpen}
        onOpenChange={setIsRescheduleDialogOpen}
        onConfirm={handleRescheduleConfirm}
        initialScheduledFor={delayedMessage.scheduledFor}
        mode='reschedule'
        trackCategory='delayed-messages'
      />

      {/* Send now confirmation (matches Drafts panel) */}
      {showSendNowConfirm && (
        <Dialog
          open
          onOpenChange={open => {
            if (!open) setShowSendNowConfirm(false);
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
                onClick={() => setShowSendNowConfirm(false)}
                className='rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0'
                aria-label='Close'
                data-track-category='delayed-messages'
                data-track-name='close-send-now-dialog'
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
                onClick={() => setShowSendNowConfirm(false)}
                className='text-sm font-medium px-4 py-2 rounded-md border border-border bg-background text-foreground hover:bg-muted/60 transition-colors'
                data-track-category='delayed-messages'
                data-track-name='cancel-send-now'
              >
                Cancel
              </button>
              <Button
                variant='default'
                type='button'
                onClick={() => void performSendNow()}
                trackId='send_now_scheduled_message'
                disabled={isSendNowLoading}
                className='text-sm font-medium px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2'
                data-track-category='delayed-messages'
                data-track-name='confirm-send-now'
              >
                {isSendNowLoading ? <Loader2 size={14} className='animate-spin' /> : null}
                Send now
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Delete confirmation (matches Drafts delete dialog shell) */}
      {showDeleteConfirm && (
        <Dialog
          open
          onOpenChange={open => {
            if (!open) setShowDeleteConfirm(false);
          }}
          title='Delete message?'
          description={`Are you sure you want to delete this scheduled message to ${displayName}?`}
          className='max-w-[420px] p-0'
        >
          <div>
            <div className='flex items-start justify-between gap-3 px-5 py-4'>
              <h2 className='text-base font-semibold text-foreground leading-tight pr-2'>
                Delete message?
              </h2>
              <button
                type='button'
                onClick={() => setShowDeleteConfirm(false)}
                className='rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0'
                aria-label='Close'
                data-track-category='delayed-messages'
                data-track-name='close-delete-scheduled-dialog'
              >
                <X className='size-4' />
              </button>
            </div>
            <p className='px-5 py-5 text-sm text-foreground leading-relaxed'>
              Are you sure you want to delete this scheduled message to{' '}
              <span className='font-semibold'>{displayName}</span>?
            </p>
            <div className='flex justify-end gap-2 px-5 py-4'>
              <button
                type='button'
                onClick={() => setShowDeleteConfirm(false)}
                className='text-sm font-medium px-4 py-2 rounded-md border border-border bg-background text-foreground hover:bg-muted/60 transition-colors'
                data-track-category='delayed-messages'
                data-track-name='cancel-delete-scheduled'
              >
                Cancel
              </button>
              <Button
                variant='ghost'
                type='button'
                onClick={() => void handleConfirmDelete()}
                trackId='delete_scheduled_message'
                className='text-sm font-bold px-4 py-2 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors'
                data-track-category='delayed-messages'
                data-track-name='confirm-delete-scheduled'
              >
                Delete message
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
};

// ─── Panel ────────────────────────────────────────────────────────────────────

const DelayedMessagesPanel = (): ReactElement => {
  const { isMobile } = usePlatform();
  const location = useLocation();
  const isOnIndexRoute = location.pathname === '/chat/scheduled';
  const [editingMessage, setEditingMessage] = useState<DelayedMessageWithAttachments | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const delayedMessages = useUserDelayedMessages();
  const items = useMemo(
    () =>
      delayedMessages
        .filter(message => message.status === DelayedMessageStatus.PENDING)
        .sort((a, b) => a.scheduledFor - b.scheduledFor || a.id.localeCompare(b.id)),
    [delayedMessages],
  );

  const handleEdit = (msg: DelayedMessageWithAttachments): void => {
    setEditingMessage(msg);
    setIsEditModalOpen(true);
  };

  return (
    <div className='flex flex-col h-full w-full bg-background'>
      {/* Mobile: show Outlet for non-index routes */}
      {isMobile && !isOnIndexRoute ? (
        <div className='flex flex-col h-full max-w-full bg-background text-foreground overflow-x-hidden w-screen'>
          <Outlet />
        </div>
      ) : (
        /* Scheduled Messages List - full width single panel */
        <div className='flex-1 overflow-y-auto p-6'>
          {items.length === 0 ? (
            <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
              <Clock className='text-muted-foreground mb-4' size={48} />
              <p className='text-muted-foreground text-lg font-medium mb-2'>
                No scheduled messages
              </p>
              <p className='text-muted-foreground text-sm max-w-md'>
                Schedule messages to be sent at a future time using the send button in any channel
              </p>
            </div>
          ) : (
            <Virtuoso<DelayedMessageWithAttachments>
              data={items}
              className='h-full'
              style={{ height: '100%' }}
              computeItemKey={(_, item) => item.id}
              itemContent={(_, msg) => (
                <DelayedMessageRow delayedMessage={msg} onEdit={handleEdit} />
              )}
            />
          )}
        </div>
      )}

      {editingMessage && (
        <DelayedMessageEditModal
          isOpen={isEditModalOpen}
          onClose={() => {
            setIsEditModalOpen(false);
            setEditingMessage(null);
          }}
          message={editingMessage}
        />
      )}
    </div>
  );
};

DelayedMessagesPanel.displayName = 'DelayedMessagesPanel';

export default DelayedMessagesPanel;
