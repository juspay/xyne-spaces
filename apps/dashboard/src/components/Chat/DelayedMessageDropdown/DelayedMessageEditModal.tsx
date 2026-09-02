import { useState, useCallback, useRef } from 'react';
import { format } from 'date-fns';
import { Clock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { DelayedMessage } from '@xyne/shared';
import { Dialog } from '../../ui/Dialog/Dialog';
import { InputBox } from '../../ui/InputBox';
import { Button } from '../../ui/Button';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { sanitizeHtmlContent } from '../ChatInput/ChatInput.utils';
import type { InputBoxHandle } from '../../../hooks/useDragAndDropAreaRef';

interface DelayedMessageEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  message: DelayedMessage;
}

export const DelayedMessageEditModal = ({
  isOpen,
  onClose,
  message,
}: DelayedMessageEditModalProps): React.ReactElement => {
  const zero = useZero();
  const [isSaving, setIsSaving] = useState(false);
  const [editorContent, setEditorContent] = useState(message.content);
  const [editorText, setEditorText] = useState('');
  const inputBoxRef = useRef<InputBoxHandle>(null);

  const hasContent = editorText.trim().length > 0;

  const handleContentChange = useCallback((html: string, text: string): void => {
    setEditorContent(html);
    setEditorText(text);
  }, []);

  const handleSave = useCallback((): void => {
    const sanitizedContent = sanitizeHtmlContent(editorContent);
    if (!sanitizedContent.trim()) {
      toast.error('Message content cannot be empty');
      return;
    }

    setIsSaving(true);
    try {
      zero.mutate(
        mutators.delayedMessages.edit({
          id: message.id,
          content: sanitizedContent,
          updatedAt: message.updatedAt,
        }),
      );
      toast.success('Scheduled message updated');
      onClose();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Please try again.';
      toast.error('Failed to update scheduled message', {
        description: errorMessage,
      });
    } finally {
      setIsSaving(false);
    }
  }, [editorContent, message.id, message.updatedAt, onClose, zero]);

  const handleCancel = useCallback((): void => {
    onClose();
  }, [onClose]);

  const scheduledDate = new Date(message.scheduledFor);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open) onClose();
      }}
      title='Edit scheduled message'
      description='Update the content of your scheduled message'
      className='max-w-lg'
    >
      <div className='p-6 space-y-4'>
        {/* Header */}
        <div className='space-y-1'>
          <h2 className='text-lg font-semibold text-foreground'>Edit Scheduled Message</h2>
          <p className='text-sm text-muted-foreground'>
            Update the content of your scheduled message.
          </p>
        </div>

        {/* Scheduled time (read-only) */}
        <div className='flex items-center gap-2 px-3 py-2 bg-muted rounded-md'>
          <Clock size={14} className='text-muted-foreground flex-shrink-0' />
          <span className='text-sm text-muted-foreground'>
            Scheduled for{' '}
            <span className='font-medium text-foreground'>
              {format(scheduledDate, 'MMM d, yyyy h:mm a')}
            </span>
          </span>
        </div>

        {/* Rich text editor */}
        <div className='rounded-lg border border-border overflow-hidden'>
          <InputBox
            id={`edit-scheduled-${message.id}`}
            channelId={message.channelId}
            value={editorContent}
            onContentChange={handleContentChange}
            onSendMessage={() => {
              void handleSave();
            }}
            onCancel={handleCancel}
            ref={inputBoxRef}
            placeholder='Edit your message...'
            disabled={isSaving}
            disableEnterToSend
            features={{
              richText: true,
              commands: true,
              mentions: true,
              fileAttachments: false,
              emojiPicker: true,
            }}
          />
        </div>

        {/* Action buttons */}
        <div className='flex justify-end gap-3 pt-2'>
          <button
            type='button'
            onClick={handleCancel}
            disabled={isSaving}
            className='text-sm font-medium px-4 py-2 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50 transition-colors'
            data-track-category='delayed-messages'
            data-track-name='cancel-edit'
          >
            Cancel
          </button>
          <Button
            variant='default'
            type='button'
            onClick={() => void handleSave()}
            trackId='edit_scheduled_message'
            disabled={isSaving || !hasContent}
            className='text-sm font-medium px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors inline-flex items-center gap-2'
            data-track-category='delayed-messages'
            data-track-name='save-edit'
          >
            {isSaving && <Loader2 size={14} className='animate-spin' />}
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

DelayedMessageEditModal.displayName = 'DelayedMessageEditModal';
