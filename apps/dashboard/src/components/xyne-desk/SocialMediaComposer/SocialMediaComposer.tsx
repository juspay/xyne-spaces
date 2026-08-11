import { ReactElement, useRef, useState, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { ArrowUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiInstance } from '../../../services/clients/apiClient';

const INSTAGRAM_CHAR_LIMIT = 1000;

interface SocialMediaComposerProps {
  conversationId: string;
}

const SocialMediaComposer = ({ conversationId }: SocialMediaComposerProps): ReactElement => {
  const [sending, setSending] = useState(false);
  const [charCount, setCharCount] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const lastTextRef = useRef('');

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        bold: false,
        italic: false,
        strike: false,
        heading: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        paragraph: { HTMLAttributes: { class: 'm-0 leading-6' } },
      }),
      Placeholder.configure({ placeholder: 'Reply via Instagram DM…' }),
    ],
    content: '',
    onFocus: () => setIsFocused(true),
    onBlur: () => setIsFocused(false),
    onUpdate: ({ editor: ed }) => {
      const text = ed.getText().trim();
      setCharCount(text.length);
      lastTextRef.current = text;
    },
    editorProps: {
      attributes: {
        class: 'tiptap chat-input-editor prose prose-sm focus:outline-none',
        style: 'min-height: 20px; max-height: 160px; overflow-y: auto;',
        'aria-label': 'Instagram DM reply input',
        role: 'textbox',
        'aria-multiline': 'true',
        spellcheck: 'true',
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.metaKey) {
          event.preventDefault();
          void handleSend();
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
    if (text.length > INSTAGRAM_CHAR_LIMIT) {
      toast.error(`Message exceeds Instagram's ${INSTAGRAM_CHAR_LIMIT} character limit`);
      return;
    }

    setSending(true);
    try {
      await apiInstance.post(`/integrations/social-media/${conversationId}/reply`, { body: text });
      editor.commands.setContent('');
      setCharCount(0);
      lastTextRef.current = '';
    } catch (error: unknown) {
      const err = error as { message?: string; response?: { data?: { error?: string } } };
      const msg = err.message ?? err.response?.data?.error ?? 'Failed to send reply';
      toast.error(msg);
    } finally {
      setSending(false);
    }
  }, [editor, sending, conversationId]);

  const canSend = charCount > 0 && charCount <= INSTAGRAM_CHAR_LIMIT && !sending;
  const isOverLimit = charCount > INSTAGRAM_CHAR_LIMIT;

  return (
    <div className='px-4 py-3 border-t border-border'>
      <div
        className={`relative overflow-hidden rounded-lg border transition-all bg-card ${
          isOverLimit
            ? 'border-destructive ring-1 ring-destructive'
            : isFocused
              ? 'border-ring'
              : 'border-input'
        }`}
      >
        <div className='relative py-2 px-3'>
          <EditorContent
            editor={editor}
            className='chat-input-field w-full resize-none border-0 outline-none bg-transparent leading-6 break-words text-foreground placeholder:text-muted-foreground text-sm'
          />
        </div>

        <div className='flex items-center justify-between px-3 py-2 border-t border-border/50'>
          <span
            className={`text-xs ${isOverLimit ? 'text-destructive font-medium' : 'text-muted-foreground'}`}
          >
            {charCount}/{INSTAGRAM_CHAR_LIMIT}
          </span>
          <button
            type='button'
            onClick={() => void handleSend()}
            disabled={!canSend}
            className={`p-2 rounded-md transition-all ${
              canSend
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
            }`}
            data-track-category='social-media-composer'
            data-track-name='send-instagram-reply'
            aria-label='Send Instagram DM reply'
          >
            {sending ? <Loader2 size={16} className='animate-spin' /> : <ArrowUp size={16} />}
          </button>
        </div>
      </div>

      <p className='mt-1.5 text-[11px] text-muted-foreground'>
        Replies are sent via Instagram DM. You must reply within 24 hours of the customer's last message.
      </p>
    </div>
  );
};

export default SocialMediaComposer;
