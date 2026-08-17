import { ReactElement, useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { AutoDraftStatus } from '@xyne/shared';
import { apiInstance, BASE_URL } from '../../../services/clients/apiClient';
import { useSlackUserAuth, useDisconnectSlackUser } from '../../../hooks/useSlackUserAuth';
import { useSlackUsers } from '../../../hooks/useSlackUsers';
import { useEmailDraftOperations, type EmailDraftRecord } from '../../../hooks/useEmailDraft';
import { useDragAndDropAreaRef } from '../../../hooks/useDragAndDropAreaRef';
import { InputBox, type InputBoxFeatures } from '../../ui/InputBox';
import Tooltip from '../../ui/Tooltip';
import DragAndDropOverlay from '../../Chat/DragAndDropOverlay';
import { uploadComposerAttachments } from '../EmailComposer/composerAttachmentUpload';

export type DeskComposerVariant = 'app' | 'slack' | 'social';

interface DeskComposerProps {
  variant: DeskComposerVariant;
  conversationId: string;
  channelId?: string | null;
  drafts?: readonly EmailDraftRecord[];
  /** app-only: who the reply is going to, used in the default placeholder */
  replyToName?: string | null;
  /** app-only: desk has no outbound channel configured — save but don't send */
  recordOnly?: boolean;
  /** social-only: overrides the default `/integrations/{variant}` reply endpoint */
  replyBasePath?: string;
  placeholder?: string;
  /** social-only: character cap enforced on send and shown as a counter */
  maxLength?: number;
  trackingCategory?: string;
}

const DEFAULT_REPLY_BASE_PATH: Record<DeskComposerVariant, string> = {
  app: '/integrations/app-desk',
  slack: '/integrations/slack-desk',
  social: '/integrations/social-media',
};

/** Social platforms don't accept rich HTML — collapse the editor's HTML back to plain text. */
function toPlainText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
}

const DeskComposer = ({
  variant,
  conversationId,
  channelId,
  drafts,
  replyToName,
  recordOnly = false,
  replyBasePath,
  placeholder,
  maxLength,
  trackingCategory = `${variant}-composer`,
}: DeskComposerProps): ReactElement => {
  const [sending, setSending] = useState(false);
  const [socialLength, setSocialLength] = useState(0);
  const { deleteDraft, latestDraft: draft } = useEmailDraftOperations(
    conversationId,
    channelId,
    drafts,
  );
  const isAutoDraftGenerating = draft?.autoDraftStatus === AutoDraftStatus.GENERATING;

  // Slack-only: send-as-user auth status and @mention search.
  const { data: slackAuth, isLoading: authLoading } = useSlackUserAuth();
  const disconnectMutation = useDisconnectSlackUser();
  const { filteredUsers, searchUsers } = useSlackUsers();

  const { dragAndDropAreaRef, inputRef, isDragging } = useDragAndDropAreaRef(conversationId);

  const resolvedReplyBasePath = replyBasePath ?? DEFAULT_REPLY_BASE_PATH[variant];
  const resolvedPlaceholder =
    placeholder ??
    (recordOnly
      ? 'Add a note to this ticket…'
      : variant === 'slack'
        ? 'Reply to thread…'
        : `Reply to ${replyToName?.trim() || 'the customer'}…`);

  const features: InputBoxFeatures =
    variant === 'social'
      ? {
          richText: false,
          commands: false,
          mentions: false,
          fileAttachments: false,
          emojiPicker: false,
        }
      : {
          richText: true,
          commands: false,
          mentions: variant === 'slack',
          fileAttachments: true,
          emojiPicker: true,
        };

  const handleSend = useCallback(
    async (text: string, html: string, files: File[]) => {
      if (sending) return;

      const body = variant === 'social' ? toPlainText(text) : html;
      if (variant === 'social' && maxLength !== undefined && body.length > maxLength) return;

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
        await apiInstance.post(`${resolvedReplyBasePath}/${conversationId}/reply`, {
          body,
          ...(attachmentIds.length > 0 && { attachmentIds }),
        });
        deleteDraft();
      } catch {
        toast.error('Failed to send message');
      } finally {
        setSending(false);
      }
    },
    [sending, variant, maxLength, conversationId, resolvedReplyBasePath, deleteDraft],
  );

  const handleConnect = (): void => {
    const isElectron = typeof window.electronAPI?.openExternal === 'function';
    const url = `${BASE_URL}/integrations/slack-user/connect${isElectron ? '?platform=electron' : ''}`;
    if (isElectron && window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url);
    } else {
      window.location.href = url;
    }
  };

  const handleDisconnect = (): void => {
    disconnectMutation.mutate(undefined, {
      onError: () => toast.error('Failed to disconnect Slack account'),
    });
  };

  return (
    <div
      ref={dragAndDropAreaRef}
      className='relative px-4 pb-4 pt-2'
      data-track-category={trackingCategory}
    >
      {features.fileAttachments && <DragAndDropOverlay isVisible={isDragging} />}

      {recordOnly && (
        <p className='mb-2 text-xs text-muted-foreground'>
          Receive-only desk — this is saved to the ticket but not sent to the app.
        </p>
      )}

      {variant === 'slack' && !authLoading && (
        <div className='flex items-center gap-2 mb-2 text-xs text-muted-foreground'>
          {slackAuth?.connected ? (
            <>
              <span className='inline-block size-1.5 rounded-full bg-green-500' />
              <span>Replying as you</span>
              <button
                type='button'
                onClick={handleDisconnect}
                disabled={disconnectMutation.isPending}
                className='text-xs text-muted-foreground underline hover:text-foreground cursor-pointer'
                data-track-category={trackingCategory}
                data-track-name='disconnect-slack-user'
              >
                Disconnect
              </button>
            </>
          ) : (
            <>
              <span className='inline-block size-1.5 rounded-full bg-muted-foreground' />
              <span>Replying as Xyne Bot</span>
              <button
                type='button'
                onClick={handleConnect}
                className='text-xs text-primary underline hover:text-primary/80 cursor-pointer'
                data-track-category={trackingCategory}
                data-track-name='connect-slack-user'
              >
                Connect your Slack
              </button>
            </>
          )}
        </div>
      )}

      <InputBox
        ref={inputRef}
        id={`desk-composer-${variant}-${conversationId}`}
        conversationId={conversationId}
        {...(channelId ? { channelId } : {})}
        onSendMessage={handleSend}
        {...(variant === 'social'
          ? { onContentChange: (_html: string, text: string) => setSocialLength(text.length) }
          : {})}
        placeholder={resolvedPlaceholder}
        value={draft?.draftContent}
        disabled={sending}
        features={features}
        {...(variant === 'slack'
          ? { mentionItems: filteredUsers, onMentionSearch: searchUsers }
          : {})}
        maxFiles={5}
        disableDraftUpload
        hideVoiceInput
        {...(variant === 'slack'
          ? {
              hasAgentActivity: isAutoDraftGenerating,
              agentSlot: (
                <Tooltip delayDuration={300} content='Generating AI draft…'>
                  <span
                    className='inline-flex items-center gap-1 h-[18px] px-1.5 rounded-sm bg-violet-100 text-[10px] font-medium text-violet-700 dark:bg-violet-950/50 dark:text-violet-300'
                    aria-label='Generating AI draft'
                  >
                    <Loader2 size={10} className='animate-spin' />
                    Drafting…
                  </span>
                </Tooltip>
              ),
            }
          : {})}
      />

      {variant === 'social' && maxLength !== undefined && (
        <div className='flex justify-end pt-1'>
          <span
            className={`text-xs ${socialLength > maxLength ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {socialLength}/{maxLength}
          </span>
        </div>
      )}
    </div>
  );
};

export default DeskComposer;
