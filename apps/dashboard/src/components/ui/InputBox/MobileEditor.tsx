import React, { useState, useEffect } from 'react';
import { EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import { Loader2 } from 'lucide-react';
import { ArrowUp, AtMark, PaperclipSlant, MicOn, Hashtag } from '@xyne/icons';
import { MobileEditorToolbar } from '../EditorToolbar/MobileEditorToolbar';
import { EmojiPickerButton } from '../EditorToolbar';
import type { EmojiClickData } from 'emoji-picker-react';

export interface MobileEditorProps {
  editor: Editor | null;
  content: string;
  allAttachments: File[];
  isSending: boolean;
  disabled?: boolean | undefined;
  emojiSizeClass: string;
  onAttachClick: () => void;
  onSend: () => void;
  placeholder?: React.ReactNode | undefined;
  showMentions?: boolean | undefined;
  onMentionClick?: (() => void) | undefined;
  onChannelClick?: (() => void) | undefined;
  onShowFormattingToolbar?: (() => void) | undefined;
  onCloseFormattingToolbar?: (() => void) | undefined;
  showFormattingToolbar?: boolean | undefined;
  showEmojiPicker?: boolean | undefined;
  onEmojiSelect?: ((emojiData: EmojiClickData) => void) | undefined;
  attachmentPreviewComponent?: React.ReactNode | undefined;
  hideSendButton?: boolean;
  showAttachButton?: boolean;
  showVoiceInput?: boolean;
  isVoiceRecording?: boolean;
  isVoiceTranscribing?: boolean;
  onVoiceToggle?: (() => void) | undefined;
}

/**
 * MobileEditor - Mobile-optimized input layout for chat messages.
 * - Collapsed (unfocused + empty): single row — attachment | placeholder | send
 * - Expanded (focused or has content): editor on top, toolbar (Aa, Emoji, @, #) below
 *
 * IMPORTANT: EditorContent is always rendered in the same DOM position to prevent
 * ProseMirror DOM detach/reattach issues on mobile that cause typed text (especially
 * @ and # triggers) to become invisible.
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
  hideSendButton = false,
  showAttachButton = true,
  showVoiceInput = false,
  isVoiceRecording = false,
  isVoiceTranscribing = false,
  onVoiceToggle,
  showMentions = false,
  onMentionClick,
  onChannelClick,
  showFormattingToolbar = false,
  onCloseFormattingToolbar,
  onShowFormattingToolbar,
  showEmojiPicker = false,
  onEmojiSelect,
  attachmentPreviewComponent,
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [hasBlockFormatting, setHasBlockFormatting] = useState(false);
  const [keepExpanded, setKeepExpanded] = useState(false);
  const hasContent = content.length > 0 || allAttachments.length > 0;

  // Check if editor is truly empty (no text, no lists, no blockquotes, no formatting)
  const isEmpty = !content && allAttachments.length === 0 && !hasBlockFormatting;

  const isCollapsed = !isFocused && isEmpty && !keepExpanded;

  // Track editor focus state and block formatting changes
  useEffect(() => {
    if (!editor) return;

    const handleFocus = () => {
      setIsFocused(true);
      setKeepExpanded(false);
    };

    const handleBlur = () => {
      setIsFocused(false);
    };

    const handleTransaction = () => {
      const active =
        editor.isActive('bulletList') ||
        editor.isActive('orderedList') ||
        editor.isActive('blockquote') ||
        editor.isActive('codeBlock');
      setHasBlockFormatting(active);
    };

    editor.on('focus', handleFocus);
    editor.on('blur', handleBlur);
    editor.on('transaction', handleTransaction);

    return () => {
      if (editor) {
        editor.off('focus', handleFocus);
        editor.off('blur', handleBlur);
        editor.off('transaction', handleTransaction);
      }
    };
  }, [editor]);

  const handleEditorClick = (): void => {
    if (!editor?.isFocused) {
      editor?.commands.focus();
    }
  };

  return (
    <div className='flex flex-col w-full'>
      {/*
        EditorContent — always mounted in this exact DOM position.
        In collapsed state, visually hidden via h-0 + overflow-hidden so the
        ProseMirror DOM is never detached/reattached.
      */}
      <div className={isCollapsed ? 'h-0 overflow-hidden' : 'px-3 pt-2'}>
        <div
          className={`
            relative py-2.5 px-3 min-h-[44px] cursor-text
            ${isSending ? '[&_.ProseMirror]:caret-transparent' : ''}
          `}
          onClick={handleEditorClick}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              // Don't intercept when editor has focus — let Enter insert newline, Space insert space
              if (editor?.isFocused) return;
              e.preventDefault();
              handleEditorClick();
            }
          }}
          role='button'
          tabIndex={0}
        >
          {isEmpty &&
            (isVoiceRecording ? (
              <div className='absolute inset-0 px-3 py-3.5 pointer-events-none select-none flex items-center gap-3'>
                <div className='flex items-end gap-[3px]' style={{ height: 20 }}>
                  {([0, 120, 60, 180, 90] as const).map((delay, i) => (
                    <div
                      key={i}
                      className='voice-wave-bar'
                      style={{ height: [11, 20, 15, 20, 11][i], animationDelay: `${delay}ms` }}
                    />
                  ))}
                </div>
                <span className='text-[14px] text-muted-foreground'>Listening...</span>
              </div>
            ) : (
              <div className='absolute inset-0 px-3 py-3.5 text-muted-foreground text-[15px] leading-relaxed pointer-events-none select-none'>
                {placeholder}
              </div>
            ))}
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
      </div>

      {/* Attachment Previews - Between Editor and Icons */}
      {attachmentPreviewComponent}

      {/* Collapsed: single row — attachment | placeholder | send */}
      {isCollapsed && (
        <div
          className='flex items-center gap-2 px-3 py-2 min-h-[52px] cursor-text'
          onClick={e => {
            if ((e.target as HTMLElement).closest('button')) return;
            handleEditorClick();
          }}
          data-track-category='CHAT_INPUT'
          data-track-name='FOCUS_MOBILE_EDITOR'
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleEditorClick();
            }
          }}
          role='button'
          tabIndex={0}
        >
          <button
            type='button'
            onClick={e => {
              e.stopPropagation();
              onAttachClick();
            }}
            data-track-category='CHAT_INPUT'
            data-track-name='ATTACH_FILES'
            disabled={disabled || isSending}
            className='p-2 text-foreground hover:text-muted-foreground transition-colors flex-shrink-0'
            aria-label='Attach files'
            onMouseDown={e => e.preventDefault()}
          >
            <PaperclipSlant className='h-5 w-5' />
          </button>

          {isVoiceRecording ? (
            <div className='flex-1 flex items-center gap-3 pointer-events-none select-none'>
              <div className='flex items-end gap-[3px]' style={{ height: 20 }}>
                {([0, 120, 60, 180, 90] as const).map((delay, i) => (
                  <div
                    key={i}
                    className='voice-wave-bar'
                    style={{ height: [11, 20, 15, 20, 11][i], animationDelay: `${delay}ms` }}
                  />
                ))}
              </div>
              <span className='text-[14px] text-muted-foreground'>Listening...</span>
            </div>
          ) : (
            <div className='flex-1 text-muted-foreground text-[15px] leading-relaxed truncate cursor-text'>
              {placeholder}
            </div>
          )}

          {showVoiceInput && onVoiceToggle && (
            <button
              type='button'
              onClick={e => {
                e.stopPropagation();
                onVoiceToggle();
              }}
              data-track-category='CHAT_INPUT'
              data-track-name='TOGGLE_VOICE_INPUT'
              disabled={disabled || isSending || isVoiceTranscribing}
              className={`p-2 rounded-full transition-colors flex-shrink-0 ${
                isVoiceRecording
                  ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                  : 'text-foreground hover:text-muted-foreground'
              }`}
              aria-label={isVoiceRecording ? 'Stop voice input' : 'Start voice input'}
            >
              {isVoiceTranscribing ? (
                <Loader2 className='h-5 w-5 animate-spin' />
              ) : (
                <MicOn className='h-5 w-5' />
              )}
            </button>
          )}

          <button
            type='button'
            disabled={true}
            className='p-2 rounded-full bg-muted/30 text-muted-foreground cursor-not-allowed scale-90 opacity-70 flex items-center justify-center flex-shrink-0'
            aria-label='Send message'
          >
            <ArrowUp className='h-5 w-5' strokeWidth={2.5} />
          </button>
        </div>
      )}

      {/* Expanded: toolbar row with Aa, Emoji, @, #, send */}
      {!isCollapsed && (
        <div className='flex items-center gap-1 px-3 pb-2 min-h-[52px]'>
          {!showFormattingToolbar ? (
            <>
              {/* Attachment button */}
              {showAttachButton && (
                <button
                  type='button'
                  onClick={onAttachClick}
                  data-track-category='CHAT_INPUT'
                  data-track-name='ATTACH_FILES'
                  disabled={disabled || isSending}
                  className='p-2 text-foreground hover:text-muted-foreground transition-colors'
                  aria-label='Attach files'
                  onMouseDown={e => e.preventDefault()}
                >
                  <PaperclipSlant className='h-5 w-5' />
                </button>
              )}

              {/* Aa Button - Text Formatting */}
              <button
                type='button'
                onClick={() => onShowFormattingToolbar?.()}
                data-track-category='CHAT_INPUT'
                data-track-name='OPEN_FORMAT_TOOLBAR'
                className='p-2 rounded-full hover:bg-accent active:bg-accent transition-colors'
                aria-label='Text formatting'
                onMouseDown={e => e.preventDefault()}
              >
                <span className='text-muted-foreground font-semibold text-xl'>Aa</span>
              </button>

              {/* Emoji Picker Button */}
              {showEmojiPicker && onEmojiSelect && (
                <div
                  onMouseDown={e => {
                    e.preventDefault();
                    setKeepExpanded(true);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setKeepExpanded(true);
                    }
                  }}
                  role='button'
                  tabIndex={0}
                >
                  <EmojiPickerButton
                    onEmojiSelect={emoji => {
                      setKeepExpanded(false);
                      onEmojiSelect(emoji);
                    }}
                    disabled={disabled || isSending}
                  />
                </div>
              )}

              {/* @ Mention Button */}
              {showMentions && onMentionClick && (
                <button
                  type='button'
                  onClick={() => {
                    editor?.chain().focus().insertContent('@').run();
                    onMentionClick();
                  }}
                  data-track-category='CHAT_INPUT'
                  data-track-name='INSERT_USER_MENTION'
                  className='p-2 rounded-full hover:bg-accent active:bg-accent transition-colors'
                  aria-label='Mention user'
                  onMouseDown={e => e.preventDefault()}
                >
                  <AtMark className='h-5 w-5 text-muted-foreground' />
                </button>
              )}

              {/* # Channel Button */}
              {showMentions && onChannelClick && (
                <button
                  type='button'
                  onClick={() => {
                    editor?.chain().focus().insertContent('#').run();
                    onChannelClick();
                  }}
                  data-track-category='CHAT_INPUT'
                  data-track-name='INSERT_CHANNEL_MENTION'
                  className='p-2 rounded-full hover:bg-accent active:bg-accent transition-colors'
                  aria-label='Mention channel'
                  onMouseDown={e => e.preventDefault()}
                >
                  <Hashtag className='h-5 w-5 text-muted-foreground' />
                </button>
              )}

              {showVoiceInput && onVoiceToggle && (
                <button
                  type='button'
                  onClick={onVoiceToggle}
                  data-track-category='CHAT_INPUT'
                  data-track-name='TOGGLE_VOICE_INPUT'
                  disabled={disabled || isSending || isVoiceTranscribing}
                  className={`p-2 rounded-full transition-colors ${
                    isVoiceRecording
                      ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                      : 'hover:bg-accent active:bg-accent text-muted-foreground'
                  }`}
                  aria-label={isVoiceRecording ? 'Stop voice input' : 'Start voice input'}
                >
                  {isVoiceTranscribing ? (
                    <Loader2 className='h-5 w-5 animate-spin' />
                  ) : (
                    <MicOn className='h-5 w-5' />
                  )}
                </button>
              )}

              {/* Spacer to push send button to the right */}
              <div className='flex-1'></div>

              {/* Send button - Last */}
              {!hideSendButton && (
                <button
                  type='button'
                  onClick={onSend}
                  data-track-category='CHAT_INPUT'
                  data-track-name='SEND_MESSAGE'
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
                  <ArrowUp className='h-5 w-5' strokeWidth={2.5} />
                </button>
              )}
            </>
          ) : (
            <MobileEditorToolbar
              editor={editor}
              onClose={() => onCloseFormattingToolbar?.()}
              onSend={onSend}
              hasContent={hasContent}
              isSending={isSending}
              disabled={disabled}
            />
          )}
        </div>
      )}
    </div>
  );
};
