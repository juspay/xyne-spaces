import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowUp,
  Bold,
  Italic,
  Code,
  FileCode,
  LinkSlant,
  ListDefault,
  ListNumber,
  StrikeThrough,
  TextClear,
  TextQuote,
  MultipleCrossCancelDefault,
} from '@xyne/icons';
import { Highlighter } from 'lucide-react';
import type { MobileEditorToolbarProps } from './EditorToolbar.types';

/**
 * MobileEditorToolbar - Mobile-optimized formatting toolbar
 * - Shows inline horizontal toolbar overlapping the input icons
 * - Has a close button on the left to dismiss
 * - Appears when the Aa icon is clicked
 * - Uses exact same icons as desktop toolbar
 * - Has horizontal scroll for overflow
 */
export const MobileEditorToolbar: React.FC<MobileEditorToolbarProps> = ({
  editor,
  onClose,
  onSend,
  hasContent,
  isSending,
  disabled,
}) => {
  const [isActive, setIsActive] = useState({
    bold: false,
    italic: false,
    strike: false,
    highlight: false,
    code: false,
    codeBlock: false,
    link: false,
    blockquote: false,
    bulletList: false,
    orderedList: false,
  });

  useEffect(() => {
    if (!editor) return;

    const updateActiveStates = (): void => {
      setIsActive({
        bold: editor.isActive('bold'),
        italic: editor.isActive('italic'),
        strike: editor.isActive('strike'),
        highlight: editor.isActive('highlight'),
        code: editor.isActive('code'),
        codeBlock: editor.isActive('codeBlock'),
        link: editor.isActive('link'),
        blockquote: editor.isActive('blockquote'),
        bulletList: editor.isActive('bulletList'),
        orderedList: editor.isActive('orderedList'),
      });
    };

    updateActiveStates();
    editor.on('transaction', updateActiveStates);

    return (): void => {
      if (editor) {
        editor.off('transaction', updateActiveStates);
      }
    };
  }, [editor]);

  const handleBold = useCallback(() => {
    editor?.chain().focus().toggleBold().run();
  }, [editor]);

  const handleItalic = useCallback(() => {
    editor?.chain().focus().toggleItalic().run();
  }, [editor]);

  const handleStrikethrough = useCallback(() => {
    editor?.chain().focus().toggleStrike().run();
  }, [editor]);

  const handleHighlight = useCallback(() => {
    editor?.chain().focus().toggleHighlight().run();
  }, [editor]);

  const handleClearFormatting = useCallback(() => {
    editor?.chain().focus().clearNodes().unsetAllMarks().run();
  }, [editor]);

  const handleCode = useCallback(() => {
    editor?.chain().focus().toggleCode().run();
  }, [editor]);

  const handleCodeBlock = useCallback(() => {
    if (!editor) return;

    const { from, to } = editor.state.selection;

    if (from !== to) {
      const selectedText = editor.state.doc.textBetween(from, to, '\n', '\n');
      const isInCodeBlock = editor.isActive('codeBlock');

      if (isInCodeBlock) {
        editor.chain().focus().toggleCodeBlock().run();
      } else {
        editor
          .chain()
          .focus()
          .deleteRange({ from, to })
          .insertContent({
            type: 'codeBlock',
            attrs: { language: 'plaintext' },
            content: [{ type: 'text', text: selectedText }],
          })
          .run();
      }
    } else {
      editor.chain().focus().toggleCodeBlock().run();
    }
  }, [editor]);

  const handleLink = useCallback(() => {
    if (!editor) return;

    const previousUrl = editor.getAttributes('link')['href'] as string | undefined;
    const url = window.prompt('URL', previousUrl ?? '');

    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  const handleBulletList = useCallback(() => {
    editor?.chain().focus().toggleBulletList().run();
  }, [editor]);

  const handleOrderedList = useCallback(() => {
    editor?.chain().focus().toggleOrderedList().run();
  }, [editor]);

  const handleBlockquote = useCallback(() => {
    editor?.chain().focus().toggleBlockquote().run();
  }, [editor]);

  if (!editor) return null;

  const supportsHighlight = editor.extensionManager.extensions.some(
    extension => extension.name === 'highlight',
  );

  const buttonClass = (active: boolean): string =>
    `p-1.5 rounded transition-all duration-200 ease-in-out flex-shrink-0 ${
      active ? 'bg-muted text-primary' : 'hover:bg-accent text-muted-foreground'
    }`;

  return (
    <div className='flex items-center gap-1 w-full overflow-hidden'>
      {/* Close Button - Fixed on left */}
      <button
        type='button'
        onClick={onClose}
        data-track-category='MOBILE_EDITOR_TOOLBAR'
        data-track-name='CLOSE_TOOLBAR'
        className='p-2 rounded-full bg-action-primary text-action-primary-foreground hover:bg-action-primary/90 transition-colors flex items-center justify-center flex-shrink-0 mr-1'
        aria-label='Close formatting toolbar'
        onMouseDown={e => e.preventDefault()}
      >
        <MultipleCrossCancelDefault className='h-5 w-5' />
      </button>

      {/* Scrollable toolbar icons */}
      <div className='flex items-center gap-1 overflow-x-auto scrollbar-hide flex-1'>
        {/* Bold */}
        <button
          type='button'
          onClick={handleBold}
          data-track-category='MOBILE_EDITOR_TOOLBAR'
          data-track-name='FORMAT_BOLD'
          className={buttonClass(isActive.bold)}
          aria-label='Bold'
          aria-pressed={isActive.bold}
          onMouseDown={e => e.preventDefault()}
        >
          <Bold className='h-4 w-4' />
        </button>

        {/* Italic */}
        <button
          type='button'
          onClick={handleItalic}
          data-track-category='MOBILE_EDITOR_TOOLBAR'
          data-track-name='FORMAT_ITALIC'
          className={buttonClass(isActive.italic)}
          aria-label='Italic'
          aria-pressed={isActive.italic}
          onMouseDown={e => e.preventDefault()}
        >
          <Italic className='h-4 w-4' />
        </button>

        {/* Strikethrough */}
        <button
          type='button'
          onClick={handleStrikethrough}
          data-track-category='MOBILE_EDITOR_TOOLBAR'
          data-track-name='FORMAT_STRIKETHROUGH'
          className={buttonClass(isActive.strike)}
          aria-label='Strikethrough'
          aria-pressed={isActive.strike}
          onMouseDown={e => e.preventDefault()}
        >
          <StrikeThrough className='h-4 w-4' />
        </button>

        {supportsHighlight && (
          <button
            type='button'
            onClick={handleHighlight}
            data-track-category='MOBILE_EDITOR_TOOLBAR'
            data-track-name='FORMAT_HIGHLIGHT'
            className={buttonClass(isActive.highlight)}
            aria-label='Highlight'
            aria-pressed={isActive.highlight}
            onMouseDown={e => e.preventDefault()}
          >
            <Highlighter className='h-4 w-4' />
          </button>
        )}

        {/* Clear Formatting */}
        <button
          type='button'
          onClick={handleClearFormatting}
          data-track-category='MOBILE_EDITOR_TOOLBAR'
          data-track-name='CLEAR_FORMATTING'
          className={buttonClass(false)}
          aria-label='Clear formatting'
          onMouseDown={e => e.preventDefault()}
        >
          <TextClear className='h-4 w-4' />
        </button>

        {/* Inline Code */}
        <button
          type='button'
          onClick={handleCode}
          data-track-category='MOBILE_EDITOR_TOOLBAR'
          data-track-name='FORMAT_INLINE_CODE'
          className={buttonClass(isActive.code)}
          aria-label='Inline code'
          aria-pressed={isActive.code}
          onMouseDown={e => e.preventDefault()}
        >
          <Code className='h-4 w-4' />
        </button>

        {/* Separator */}
        <div className='h-4 w-px bg-border mx-1 flex-shrink-0' aria-hidden='true' />

        {/* Code Block */}
        <button
          type='button'
          onClick={handleCodeBlock}
          data-track-category='MOBILE_EDITOR_TOOLBAR'
          data-track-name='FORMAT_CODE_BLOCK'
          className={buttonClass(isActive.codeBlock)}
          aria-label='Code block'
          aria-pressed={isActive.codeBlock}
          onMouseDown={e => e.preventDefault()}
        >
          <FileCode className='h-4 w-4' />
        </button>

        {/* Link */}
        <button
          type='button'
          onClick={handleLink}
          data-track-category='MOBILE_EDITOR_TOOLBAR'
          data-track-name='OPEN_LINK_PROMPT'
          className={buttonClass(isActive.link)}
          aria-label='Insert link'
          aria-pressed={isActive.link}
          onMouseDown={e => e.preventDefault()}
        >
          <LinkSlant className='h-4 w-4' />
        </button>

        {/* Separator */}
        <div className='h-4 w-px bg-border mx-1 flex-shrink-0' aria-hidden='true' />

        {/* Blockquote */}
        <button
          type='button'
          onClick={handleBlockquote}
          data-track-category='MOBILE_EDITOR_TOOLBAR'
          data-track-name='FORMAT_BLOCKQUOTE'
          className={buttonClass(isActive.blockquote)}
          aria-label='Quote'
          aria-pressed={isActive.blockquote}
          onMouseDown={e => e.preventDefault()}
        >
          <TextQuote className='h-4 w-4' />
        </button>

        {/* Bullet List */}
        <button
          type='button'
          onClick={handleBulletList}
          data-track-category='MOBILE_EDITOR_TOOLBAR'
          data-track-name='FORMAT_BULLET_LIST'
          className={buttonClass(isActive.bulletList)}
          aria-label='Bullet list'
          aria-pressed={isActive.bulletList}
          onMouseDown={e => e.preventDefault()}
        >
          <ListDefault className='h-4 w-4' />
        </button>

        {/* Ordered List */}
        <button
          type='button'
          onClick={handleOrderedList}
          data-track-category='MOBILE_EDITOR_TOOLBAR'
          data-track-name='FORMAT_NUMBERED_LIST'
          className={buttonClass(isActive.orderedList)}
          aria-label='Numbered list'
          aria-pressed={isActive.orderedList}
          onMouseDown={e => e.preventDefault()}
        >
          <ListNumber className='h-4 w-4' />
        </button>
      </div>

      {/* Send button - Always visible on right */}
      <button
        type='button'
        onClick={onSend}
        data-track-category='MOBILE_EDITOR_TOOLBAR'
        data-track-name='SEND_MESSAGE'
        disabled={disabled || isSending || !hasContent}
        className={`
          p-2 rounded-full transition-all duration-300 flex items-center justify-center flex-shrink-0 ml-1
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
    </div>
  );
};
