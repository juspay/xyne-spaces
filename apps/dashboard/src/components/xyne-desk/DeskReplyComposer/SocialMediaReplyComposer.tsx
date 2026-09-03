import { ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiInstance } from '../../../services/clients/apiClient';
import { useEmailDraftOperations, type EmailDraftRecord } from '../../../hooks/useEmailDraft';

interface SocialMediaReplyComposerProps {
  conversationId: string;
  channelId?: string | null;
  drafts?: readonly EmailDraftRecord[];
  replyBasePath: string;
  placeholder: string;
  maxLength?: number;
  trackingCategory: string;
}

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

export const SocialMediaReplyComposer = ({
  conversationId,
  channelId,
  drafts,
  replyBasePath,
  placeholder,
  maxLength,
  trackingCategory,
}: SocialMediaReplyComposerProps): ReactElement => {
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const loadedDraftRef = useRef('');
  const { deleteDraft, latestDraft: draft } = useEmailDraftOperations(
    conversationId,
    channelId,
    drafts,
  );

  useEffect(() => {
    const nextDraft = draft?.draftContent ?? '';
    if (nextDraft === loadedDraftRef.current) return;
    loadedDraftRef.current = nextDraft;
    setContent(toPlainText(nextDraft));
  }, [draft?.draftContent]);

  const handleSend = useCallback(async () => {
    const body = content.trim();
    if (!body || sending || (maxLength !== undefined && body.length > maxLength)) return;

    setSending(true);
    try {
      await apiInstance.post(`${replyBasePath}/${conversationId}/reply`, { body });
      setContent('');
      loadedDraftRef.current = '';
      deleteDraft();
    } catch {
      toast.error('Failed to send reply');
    } finally {
      setSending(false);
    }
  }, [content, conversationId, deleteDraft, maxLength, replyBasePath, sending]);

  const canSend =
    content.trim().length > 0 &&
    (maxLength === undefined || content.length <= maxLength) &&
    !sending;

  return (
    <div className='px-4 py-3 border-t border-border'>
      <div className='overflow-hidden rounded-lg border border-input bg-card focus-within:border-ring'>
        <textarea
          value={content}
          onChange={event => setContent(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void handleSend();
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          rows={3}
          className='block min-h-20 max-h-48 w-full resize-y bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground'
          data-track-category={trackingCategory}
          data-track-name='compose-reply'
        />
        <div className='flex items-center justify-end gap-2 border-t border-border/50 p-2'>
          {maxLength !== undefined && (
            <span
              className={`text-xs ${
                content.length > maxLength ? 'text-destructive' : 'text-muted-foreground'
              }`}
            >
              {content.length}/{maxLength}
            </span>
          )}
          <button
            type='button'
            onClick={() => void handleSend()}
            disabled={!canSend}
            className={`rounded-md p-2 transition-all ${
              canSend
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'cursor-not-allowed bg-muted text-muted-foreground opacity-50'
            }`}
            data-track-category={trackingCategory}
            data-track-name='send-reply'
            aria-label='Send reply'
            data-ph-capture-attribute-track-id='desk_send_social_reply'
          >
            {sending ? <Loader2 size={16} className='animate-spin' /> : <ArrowUp size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
};
