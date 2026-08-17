import { ReactElement, useCallback, useState } from 'react';
import { toast } from 'sonner';
import { apiInstance } from '../../../services/clients/apiClient';
import { useEmailDraftOperations, type EmailDraftRecord } from '../../../hooks/useEmailDraft';
import { InputBox } from '../../ui/InputBox';
import { uploadComposerAttachments } from '../EmailComposer/composerAttachmentUpload';

interface AppComposerProps {
  conversationId: string;
  channelId?: string | null;
  drafts?: readonly EmailDraftRecord[];
  replyToName?: string | null;
  recordOnly?: boolean;
}

const AppComposer = ({
  conversationId,
  channelId,
  drafts,
  replyToName,
  recordOnly = false,
}: AppComposerProps): ReactElement => {
  const [sending, setSending] = useState(false);
  const { deleteDraft, latestDraft: draft } = useEmailDraftOperations(
    conversationId,
    channelId,
    drafts,
  );

  const placeholder = recordOnly
    ? 'Add a note to this ticket…'
    : `Reply to ${replyToName?.trim() || 'the customer'}…`;

  const handleSend = useCallback(
    async (_text: string, html: string, files: File[]) => {
      if (sending) return;
      setSending(true);
      try {
        let attachmentIds: string[] = [];
        if (files.length > 0) {
          const upload = await uploadComposerAttachments({ files, conversationId });
          attachmentIds = upload.attachmentIds;
          if (upload.failures?.length) {
            toast.error(upload.failures.map(f => `${f.filename}: ${f.error}`).join('; '));
          }
        }
        await apiInstance.post(`/integrations/app-desk/${conversationId}/reply`, {
          body: html,
          ...(attachmentIds.length > 0 && { attachmentIds }),
        });
        deleteDraft();
      } catch {
        toast.error('Failed to send message');
      } finally {
        setSending(false);
      }
    },
    [conversationId, deleteDraft, sending],
  );

  return (
    <div className='px-4 pb-4 pt-2'>
      {recordOnly && (
        <p className='mb-2 text-xs text-muted-foreground'>
          Receive-only desk — this is saved to the ticket but not sent to the app.
        </p>
      )}
      <InputBox
        id={`app-desk-reply-${conversationId}`}
        onSendMessage={handleSend}
        placeholder={placeholder}
        value={draft?.draftContent}
        disabled={sending}
        features={{
          richText: true,
          commands: false,
          mentions: false,
          fileAttachments: true,
          emojiPicker: true,
        }}
        maxFiles={5}
        disableDraftUpload
        hideVoiceInput
      />
    </div>
  );
};

export default AppComposer;
