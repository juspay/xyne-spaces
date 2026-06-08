import { ReactElement, useState, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import LinkExtension from '@tiptap/extension-link';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { all, createLowlight } from 'lowlight';
import { ArrowUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { EmojiClickData } from 'emoji-picker-react';
import { apiInstance, BASE_URL } from '../../../services/clients/apiClient';
import { useSlackUserAuth, useDisconnectSlackUser } from '../../../hooks/useSlackUserAuth';
import { useSlackUsers } from '../../../hooks/useSlackUsers';
import { EditorToolbar, EmojiPickerButton } from '../../ui/EditorToolbar';
import { MentionExtension, mentionPluginKey } from '../../ui/TipTapExtensions';
import { MentionSelector } from '../../ui/Selectors';

const lowlight = createLowlight(all);

interface SlackComposerProps {
  conversationId: string;
}

const SlackComposer = ({ conversationId }: SlackComposerProps): ReactElement => {
  const [sending, setSending] = useState(false);
  const [content, setContent] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const { data: slackAuth, isLoading: authLoading } = useSlackUserAuth();
  const disconnectMutation = useDisconnectSlackUser();
  const { filteredUsers, searchUsers } = useSlackUsers();

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
        HTMLAttributes: {
          class: 'bg-slate-50 border border-slate-200 rounded-lg overflow-x-auto relative',
          style: 'padding: 0.75rem;',
        },
      }),
      LinkExtension.extend({ inclusive: false }).configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-link-color hover:text-link-hover-color underline cursor-text',
          rel: 'noopener noreferrer',
        },
      }),
      Placeholder.configure({ placeholder: 'Reply to thread...' }),
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
    },
  });

  const handleSend = useCallback(async () => {
    if (!editor || sending) return;
    const text = editor.getText().trim();
    if (!text) return;

    setSending(true);
    try {
      const html = editor.getHTML();
      await apiInstance.post(`/integrations/slack-desk/${conversationId}/reply`, {
        body: html,
      });
      editor.commands.setContent('');
      setContent('');
    } catch {
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  }, [editor, sending, conversationId]);

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
      {/* Auth status */}
      {!authLoading && (
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
              >
                Connect your Slack
              </button>
            </>
          )}
        </div>
      )}

      {/* Rich text editor */}
      <div
        className={`overflow-hidden rounded-lg border transition-all bg-card ${
          isFocused ? 'border-ring' : 'border-input'
        }`}
        data-track-category='slack-composer'
        data-track-name='compose-reply'
      >
        {/* Mention dropdown */}
        <MentionSelector
          editor={editor}
          mentionItems={filteredUsers}
          onMentionSearch={searchUsers}
        />

        {/* Formatting toolbar */}
        <EditorToolbar editor={editor} />

        {/* Editor area */}
        <div className='relative py-2 px-3'>
          <EditorContent
            editor={editor}
            className='chat-input-field w-full resize-none border-0 outline-none bg-transparent leading-6 break-words text-foreground placeholder:text-muted-foreground text-sm [&_a]:pointer-events-none'
          />
        </div>

        {/* Footer: emoji + send */}
        <div className='flex items-center justify-between p-2 border-t border-border/50'>
          <div className='flex items-center gap-1'>
            <EmojiPickerButton onEmojiSelect={handleEmojiSelect} disabled={sending} />
          </div>
          <button
            type='button'
            onClick={() => void handleSend()}
            disabled={!content || sending}
            className={`p-2 rounded-md transition-all ${
              content && !sending
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
            }`}
            data-track-category='slack-composer'
            data-track-name='send-reply'
            aria-label='Send reply'
          >
            {sending ? <Loader2 size={16} className='animate-spin' /> : <ArrowUp size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SlackComposer;
