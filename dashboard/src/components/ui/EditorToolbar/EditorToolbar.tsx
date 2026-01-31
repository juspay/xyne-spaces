import React, { useCallback, useEffect, useState } from 'react';
import { Tooltip, TooltipAlign, TooltipSide } from '@juspay/blend-design-system';
import { Bold, Italic, Code, FileCode, Link, List, ListOrdered, TextQuote } from 'lucide-react';
import type { EditorToolbarProps } from './EditorToolbar.types';

export const EditorToolbar: React.FC<EditorToolbarProps> = ({ editor }) => {
  const [isActive, setIsActive] = useState({
    bold: false,
    italic: false,
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
      editor.off('transaction', updateActiveStates);
    };
  }, [editor]);

  const handleBold = useCallback(() => {
    editor?.chain().focus().toggleBold().run();
  }, [editor]);

  const handleItalic = useCallback(() => {
    editor?.chain().focus().toggleItalic().run();
  }, [editor]);

  const handleCode = useCallback(() => {
    editor?.chain().focus().toggleCode().run();
  }, [editor]);

  const handleCodeBlock = useCallback(() => {
    if (!editor) return;

    const { from, to } = editor.state.selection;

    // If there's a selection, create a single code block for the entire selection
    if (from !== to) {
      // Get the selected text, preserving newlines
      const selectedText = editor.state.doc.textBetween(from, to, '\n', '\n');

      // Check if the selection is already in a code block
      const isInCodeBlock = editor.isActive('codeBlock');

      if (isInCodeBlock) {
        // If already in a code block, just toggle it off
        editor.chain().focus().toggleCodeBlock().run();
      } else {
        // If not in a code block, replace the selection with a code block containing only the selected text
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
      // If no selection, use the default toggle behavior
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

  const buttonClass = (active: boolean): string =>
    `p-1.5 rounded transition-all duration-200 ease-in-out ${
      active ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'
    }`;

  return (
    <div className='border-gray-200 p-1'>
      <div className='flex items-center gap-1 px-3 py-2 bg-[#FAFAFA] rounded-xl'>
        <Tooltip
          content='Bold (⌘B)'
          side={TooltipSide.TOP}
          delayDuration={500}
          align={TooltipAlign.START}
        >
          <button
            type='button'
            onClick={handleBold}
            className={buttonClass(isActive.bold)}
            aria-label='Bold'
            aria-pressed={isActive.bold}
          >
            <Bold className='h-4 w-4' />
          </button>
        </Tooltip>

        <Tooltip
          content='Italic (⌘I)'
          side={TooltipSide.TOP}
          delayDuration={500}
          align={TooltipAlign.START}
        >
          <button
            type='button'
            onClick={handleItalic}
            className={buttonClass(isActive.italic)}
            aria-label='Italic'
            aria-pressed={isActive.italic}
          >
            <Italic className='h-4 w-4' />
          </button>
        </Tooltip>

        <Tooltip
          content='Inline Code (⌘E)'
          side={TooltipSide.TOP}
          delayDuration={500}
          align={TooltipAlign.START}
        >
          <button
            type='button'
            onClick={handleCode}
            className={buttonClass(isActive.code)}
            aria-label='Inline code'
            aria-pressed={isActive.code}
          >
            <Code className='h-4 w-4' />
          </button>
        </Tooltip>

        <div className='h-4 w-px bg-gray-300 mx-1' aria-hidden='true' />

        <Tooltip
          content='Code Block (⌘⇧E)'
          side={TooltipSide.TOP}
          delayDuration={500}
          align={TooltipAlign.START}
        >
          <button
            type='button'
            onClick={handleCodeBlock}
            className={buttonClass(isActive.codeBlock)}
            aria-label='Code block'
            aria-pressed={isActive.codeBlock}
          >
            <FileCode className='h-4 w-4' />
          </button>
        </Tooltip>

        <Tooltip
          content='Insert Link (⌘K)'
          side={TooltipSide.TOP}
          delayDuration={500}
          align={TooltipAlign.START}
        >
          <button
            type='button'
            onClick={handleLink}
            className={buttonClass(isActive.link)}
            aria-label='Insert link'
            aria-pressed={isActive.link}
          >
            <Link className='h-4 w-4' />
          </button>
        </Tooltip>

        <div className='h-4 w-px bg-gray-300 mx-1' aria-hidden='true' />

        <Tooltip
          content='Blockquote (⌘⇧B)'
          side={TooltipSide.TOP}
          delayDuration={500}
          align={TooltipAlign.START}
        >
          <button
            type='button'
            onClick={handleBlockquote}
            className={buttonClass(isActive.blockquote)}
            aria-label='Quote'
            aria-pressed={isActive.blockquote}
          >
            <TextQuote className='h-4 w-4' />
          </button>
        </Tooltip>

        <Tooltip
          content='Bullet List'
          side={TooltipSide.TOP}
          delayDuration={500}
          align={TooltipAlign.START}
        >
          <button
            type='button'
            onClick={handleBulletList}
            className={buttonClass(isActive.bulletList)}
            aria-label='Bullet list'
            aria-pressed={isActive.bulletList}
          >
            <List className='h-4 w-4' />
          </button>
        </Tooltip>

        <Tooltip
          content='Numbered List'
          side={TooltipSide.TOP}
          delayDuration={500}
          align={TooltipAlign.START}
        >
          <button
            type='button'
            onClick={handleOrderedList}
            className={buttonClass(isActive.orderedList)}
            aria-label='Numbered list'
            aria-pressed={isActive.orderedList}
          >
            <ListOrdered className='h-4 w-4' />
          </button>
        </Tooltip>
      </div>
    </div>
  );
};
