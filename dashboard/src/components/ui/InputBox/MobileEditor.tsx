import React from 'react';
import { EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/react';

export interface MobileEditorProps {
  editor: Editor | null;
  content: string;
  allAttachments: File[];
  isSending: boolean;
  disabled?: boolean;
  emojiSizeClass: string;
  onAttachClick: () => void;
  onSend: () => void;
  placeholder?: string;
}

/**
 * MobileEditor - Mobile-optimized input layout for chat messages.
 * - Attachment button on the left
 * - Editor content in the middle
 * - Send button on the right
 *
 * This component is rendered inside InputBox for mobile viewports only.
 */
export const MobileEditor: React.FC<MobileEditorProps> = ({
  editor,
  content,
  allAttachments,
  isSending,
  disabled = false,
  emojiSizeClass,
  onAttachClick,
  onSend,
  placeholder,
}) => {
  const hasContent = content.length > 0 || allAttachments.length > 0;
  const isEmpty = !content && allAttachments.length === 0;

  return (
    <div className='flex items-end w-full'>
      {/* Attachment button on LEFT */}
      <div className='pl-3 pb-3.5 flex items-center'>
        <button
          type='button'
          onClick={onAttachClick}
          disabled={disabled || isSending}
          className='text-foreground hover:text-muted-foreground transition-colors'
          aria-label='Attach files'
          onMouseDown={e => e.preventDefault()}
        >
          <svg
            width='22'
            height='22'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
            strokeLinejoin='round'
          >
            <path d='m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48' />
          </svg>
        </button>
      </div>

      {/* Editor Content */}
      <div
        className={`
          relative flex-1 py-2.5 px-3 min-h-[44px]
          ${isSending ? '[&_.ProseMirror]:caret-transparent' : ''}
        `}
      >
        {isEmpty && (
          <div className='absolute inset-0 px-3 py-3.5 text-muted-foreground text-[15px] leading-relaxed truncate pointer-events-none select-none'>
            {placeholder}
          </div>
        )}
        <EditorContent
          editor={editor}
          className={`
            chat-input-field w-full resize-none border-0 outline-none bg-transparent leading-relaxed break-words text-[15px]
            text-foreground
            ${emojiSizeClass}
            [&_p.is-editor-empty:before]:hidden
          `}
        />
      </div>

      {/* Send button on RIGHT */}
      <div className='pr-3 pb-2.5 flex items-center'>
        <button
          type='button'
          onClick={onSend}
          disabled={disabled || isSending || !hasContent}
          className={`
            p-2 rounded-full transition-all duration-300 flex items-center justify-center
            ${
              hasContent
                ? 'bg-primary text-primary-foreground shadow-md shadow-primary/30 transform hover:scale-105 active:scale-95'
                : 'bg-muted/30 text-muted-foreground cursor-not-allowed scale-90 opacity-70'
            }
          `}
          aria-label='Send message'
          data-testid='send-message-button'
        >
          <svg
            width='20'
            height='20'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='2.5'
            strokeLinecap='round'
            strokeLinejoin='round'
          >
            <path d='m5 12 7-7 7 7' />
            <path d='M12 19V5' />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default MobileEditor;
