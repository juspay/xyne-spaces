import { ReactElement, useEffect, useRef, useState, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import LinkExtension from '@tiptap/extension-link';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { all, createLowlight } from 'lowlight';
import { ArrowUp, Loader2, Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import { getApiErrorMessage } from '../../../utils/apiError';
import type { EmojiClickData } from 'emoji-picker-react';
import { AutoDraftStatus } from '@xyne/shared';
import { apiInstance, BASE_URL } from '../../../services/clients/apiClient';
import { useSlackUserAuth, useDisconnectSlackUser } from '../../../hooks/useSlackUserAuth';
import { useSlackUsers } from '../../../hooks/useSlackUsers';
import { useEmailDraftOperations, type EmailDraftRecord } from '../../../hooks/useEmailDraft';
import Tooltip from '../../ui/Tooltip';
import { EditorToolbar, EmojiPickerButton } from '../../ui/EditorToolbar';
import { MentionExtension, mentionPluginKey } from '../../ui/TipTapExtensions';
import { MentionSelector } from '../../ui/Selectors';
import { useComposerDragDrop } from '../EmailComposer/useComposerDragDrop';
import { uploadComposerAttachments } from '../EmailComposer/composerAttachmentUpload';

const lowlight = createLowlight(all);

interface SlackComposerProps {
  conversationId: string;
  channelId?: string | null;
  drafts?: readonly EmailDraftRecord[];
  variant?: 'slack' | 'app';
  recordOnly?: boolean;
}

const SlackComposer = ({
  conversationId,
  channelId,
  drafts,
  variant = 'slack',
  recordOnly = false,
}: SlackComposerProps): ReactElement => {
  const [sending, setSending] = useState(false);
  const [content, setContent] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [attachments, setAttachments] = useState<{ id: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: slackAuth, isLoading: authLoading } = useSlackUserAuth();
  const disconnectMutation = useDisconnectSlackUser();
  const { filteredUsers, searchUsers } = useSlackUsers();
  const { deleteDraft, latestDraft: draft } = useEmailDraftOperations(
    conversationId,
    channelId,
    drafts,
  );
  const isAutoDraftGenerating = draft?.autoDraftStatus === AutoDraftStatus.GENERATING;
  const lastLoadedDraftRef = useRef<string>('');

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        bold: { HTMLAttributes: { class: 'font-semibold' } },
        italic: { HTMLAttributes: { class: 'italic' } },
        strike: { HTMLAttributes: { class: 'line-through' } },
        code: {
          HTMLAttributes: {
            class: 'bg-muted rounded px-1 py-0.5 text-foreground font-mono text-[0.85em]',
          },
        },
        blockquote: {
          HTMLAttributes: {
            class: 'border-l-4 border-muted-foreground pl-4 text-foreground',
          },
        },
        bulletList: { HTMLAttributes: { class: 'pl-6 my-2' } },
        orderedList: { HTMLAttributes: { class: 'my-2' } },
        listItem: { HTMLAttributes: { class: 'my-1' } },
        paragraph: { HTMLAttributes: { class: 'm-0 leading-6' } },
      }),
      CodeBlockLowlight.configure({
        lowlight,
        defaultLanguage: 'plaintext',
      }),
      LinkExtension.extend({ inclusive: false }).configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-link-color hover:text-link-hover-color underline cursor-text',
          rel: 'noopener noreferrer',
        },
      }),
      Placeholder.configure({
        placeholder: recordOnly ? 'Add a note to this ticket...' : 'Reply to thread...',
      }),
      MentionExtension.configure({ userActions: [], groupActions: [] }),
    ],
    content: '',
    onFocus: () => setIsFocused(true),
    onBlur: () => setIsFocused(false),
    onUpdate: ({ editor: ed }) => {
      setContent(ed.getText().trim());
    },
    editorProps: {
      attributes: {
        class: 'tiptap chat-input-editor prose prose-sm focus:outline-none',
        style: 'min-height: 20px; max-height: 200px; overflow-y: auto;',
        'aria-label': 'Slack reply input',
        role: 'textbox',
        'aria-multiline': 'true',
        spellcheck: 'true',
      },
      handleKeyDown: (view, event) => {
        // Enter without modifiers: send (unless selector is open or in special block)
        if (event.key === 'Enter' && !event.shiftKey && !event.metaKey) {
          // If mention dropdown is open, let the selector plugin handle Enter
          const mentionState = mentionPluginKey.getState(view.state);
          if (mentionState?.isOpen && mentionState.items.length > 0) {
            return false;
          }

          if (
            editor?.isActive('codeBlock') ||
            editor?.isActive('bulletList') ||
            editor?.isActive('orderedList') ||
            editor?.isActive('blockquote')
          ) {
            return false;
          }
          event.preventDefault();
          void handleSend();
          return true;
        }

        // Strikethrough: Cmd+Shift+X / Ctrl+Shift+X
        if (
          (event.key === 'x' || event.key === 'X') &&
          event.shiftKey &&
          (event.metaKey || event.ctrlKey)
        ) {
          event.preventDefault();
          event.stopPropagation();
          editor?.chain().focus().toggleStrike().run();
          return true;
        }

        return false;
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length > 0) {
          event.preventDefault();
          void uploadFilesList(files);
          return true;
        }
        return false;
      },
    },
  });

  const handleSend = useCallback(async () => {
    if (!editor || sending || uploading) return;
    const text = editor.getText().trim();
    if (!text && attachments.length === 0) return;

    setSending(true);
    try {
      const html = editor.getHTML();
      const replyBase = variant === 'app' ? '/integrations/app-desk' : '/integrations/slack-desk';
      await apiInstance.post(`${replyBase}/${conversationId}/reply`, {
        body: html,
        ...(attachments.length > 0 && { attachmentIds: attachments.map(a => a.id) }),
      });
      editor.commands.setContent('');
      setContent('');
      setAttachments([]);
      lastLoadedDraftRef.current = '';
      deleteDraft();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to send message'));
    } finally {
      setSending(false);
    }
  }, [editor, sending, uploading, attachments, conversationId, deleteDraft, variant]);

  const uploadFilesList = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setUploading(true);
      try {
        const { attachmentIds, failures } = await uploadComposerAttachments({
          files,
          conversationId,
        });
        if (failures?.length) {
          toast.error(failures.map(f => `${f.filename}: ${f.error}`).join('; '));
        }
        setAttachments(prev => [
          ...prev,
          ...attachmentIds.map((id, i) => ({ id, name: files[i]?.name ?? 'file' })),
        ]);
      } catch {
        toast.error('Failed to upload attachment');
      } finally {
        setUploading(false);
      }
    },
    [conversationId],
  );

  const handleFilesSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = '';
      void uploadFilesList(files);
    },
    [uploadFilesList],
  );

  const { isDraggingFiles, dragHandlers } = useComposerDragDrop(uploadFilesList);

  const removeAttachment = (id: string): void =>
    setAttachments(prev => prev.filter(a => a.id !== id));

  useEffect(() => {
    if (!editor) return;
    const next = draft?.draftContent ?? '';
    if (next === lastLoadedDraftRef.current) return;
    lastLoadedDraftRef.current = next;
    editor.commands.setContent(next || '');
    setContent(editor.getText().trim());
  }, [editor, draft?.draftContent]);

  const handleConnect = () => {
    const isElectron = typeof window.electronAPI?.openExternal === 'function';
    const url = `${BASE_URL}/integrations/slack-user/connect${isElectron ? '?platform=electron' : ''}`;
    if (isElectron && window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url);
    } else {
      window.location.href = url;
    }
  };

  const handleDisconnect = () => {
    disconnectMutation.mutate(undefined, {
      onError: () => toast.error('Failed to disconnect Slack account'),
    });
  };

  const handleEmojiSelect = useCallback(
    (emojiData: EmojiClickData) => {
      if (!editor) return;
      editor.chain().focus().insertContent(emojiData.emoji).run();
    },
    [editor],
  );

  return (
    <div className='px-4 py-3 border-t border-border'>
      {recordOnly && (
        <div className='mb-2 text-xs text-muted-foreground'>
          Receive-only desk — this is saved to the ticket but not sent to the app.
        </div>
      )}
      {/* Auth status (Slack send-as-user — not applicable to app desks) */}
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
                data-track-category='slack-composer'
                data-track-name='disconnect-slack-user'
                data-ph-capture-attribute-track-id='disconnect_slack_user'
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
                data-track-category='slack-composer'
                data-track-name='connect-slack-user'
                data-ph-capture-attribute-track-id='connect_slack_user'
              >
                Connect your Slack
              </button>
            </>
          )}
        </div>
      )}

      {/* Rich text editor */}
      <div
        className={`relative overflow-hidden rounded-lg border transition-all bg-card ${
          isDraggingFiles
            ? 'border-primary ring-1 ring-primary'
            : isFocused
              ? 'border-ring'
              : 'border-input'
        }`}
        data-track-category='slack-composer'
        data-track-name='compose-reply'
        {...dragHandlers}
      >
        {isDraggingFiles && (
          <div className='absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-primary/10 border-2 border-dashed border-primary pointer-events-none'>
            <span className='flex items-center gap-2 text-sm font-medium text-primary'>
              <Paperclip size={16} />
              Drop files to attach
            </span>
          </div>
        )}
        {/* Mention dropdown */}
        <MentionSelector
          editor={editor}
          mentionItems={filteredUsers}
          onMentionSearch={searchUsers}
        />

        {/* Formatting toolbar — the autodraft indicator is overlaid (absolute)
            so it doesn't wrap the toolbar in a flex container, which would break
            the toolbar's own pill layout. */}
        <div className='relative'>
          <EditorToolbar editor={editor} />
          {isAutoDraftGenerating && (
            <div className='absolute right-3 top-1/2 -translate-y-1/2'>
              <Tooltip delayDuration={300} content='Generating AI draft…'>
                <span
                  className='inline-flex items-center gap-1 h-[18px] px-1.5 rounded-sm bg-violet-100 text-[10px] font-medium text-violet-700 dark:bg-violet-950/50 dark:text-violet-300'
                  aria-label='Generating AI draft'
                >
                  <Loader2 size={10} className='animate-spin' />
                  Drafting…
                </span>
              </Tooltip>
            </div>
          )}
        </div>

        {/* Editor area */}
        <div className='relative py-2 px-3'>
          <EditorContent
            editor={editor}
            className='chat-input-field w-full resize-none border-0 outline-none bg-transparent leading-6 break-words text-foreground placeholder:text-muted-foreground text-sm [&_a]:pointer-events-none'
          />
        </div>

        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div className='flex flex-wrap gap-2 px-3 pb-2'>
            {attachments.map(a => (
              <span
                key={a.id}
                className='inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs text-foreground max-w-[200px]'
              >
                <Paperclip size={12} className='shrink-0 text-muted-foreground' />
                <span className='truncate'>{a.name}</span>
                <button
                  type='button'
                  onClick={() => removeAttachment(a.id)}
                  className='shrink-0 text-muted-foreground hover:text-foreground'
                  aria-label={`Remove ${a.name}`}
                  data-track-category='slack-composer'
                  data-track-name='remove-attachment'
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Footer: attach + emoji + send */}
        <div className='flex items-center justify-between p-2 border-t border-border/50'>
          <div className='flex items-center gap-1'>
            <input
              ref={fileInputRef}
              type='file'
              multiple
              className='hidden'
              onChange={e => void handleFilesSelected(e)}
            />
            <button
              type='button'
              onClick={() => fileInputRef.current?.click()}
              disabled={sending || uploading}
              className='p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
              data-track-category='slack-composer'
              data-track-name='attach-file'
              aria-label='Attach files'
            >
              {uploading ? <Loader2 size={16} className='animate-spin' /> : <Paperclip size={16} />}
            </button>
            <EmojiPickerButton onEmojiSelect={handleEmojiSelect} disabled={sending} />
          </div>
          {(() => {
            const canSend = (!!content || attachments.length > 0) && !sending && !uploading;
            return (
              <button
                type='button'
                onClick={() => void handleSend()}
                disabled={!canSend}
                className={`p-2 rounded-md transition-all ${
                  canSend
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
                }`}
                data-track-category='slack-composer'
                data-track-name='send-reply'
                aria-label='Send reply'
                data-ph-capture-attribute-track-id='send_slack_reply'
              >
                {sending ? <Loader2 size={16} className='animate-spin' /> : <ArrowUp size={16} />}
              </button>
            );
          })()}
        </div>
      </div>
    </div>
  );
};

export default SlackComposer;
