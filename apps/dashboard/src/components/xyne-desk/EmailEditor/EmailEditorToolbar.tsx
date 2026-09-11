import React, { useCallback, useState, useRef, useEffect } from 'react';
import { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Type,
  Palette,
  Highlighter,
  List,
  ListOrdered,
  TextQuote,
  Link,
  X,
  ChevronDown,
  RemoveFormatting,
} from 'lucide-react';
import { Tooltip } from '../../ui/Tooltip';
import Dialog from '../../ui/Dialog';
import Button from '../../ui/Button';
import * as Popover from '@radix-ui/react-popover';

interface EmailEditorToolbarProps {
  editor: Editor | null;
  rightSlot?: React.ReactNode;
  bubble?: boolean;
}

// Font size options (in pixels)
const FONT_SIZES = [
  { label: '12', value: '12px' },
  { label: '14', value: '14px' },
  { label: '16', value: '16px' },
  { label: '18', value: '18px' },
  { label: '20', value: '20px' },
  { label: '24', value: '24px' },
];

// Font family options
const FONT_FAMILIES = [
  { label: 'Default', value: '' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
];

// Color palette
const TEXT_COLORS = [
  '#000000',
  '#434343',
  '#666666',
  '#999999',
  '#b7b7b7',
  '#cccccc',
  '#d9d9d9',
  '#efefef',
  '#f3f3f3',
  '#ffffff',
  '#980000',
  '#ff0000',
  '#ff9900',
  '#ffff00',
  '#00ff00',
  '#00ffff',
  '#4a86e8',
  '#0000ff',
  '#9900ff',
  '#ff00ff',
  '#e6b8af',
  '#f4cccc',
  '#fce5cd',
  '#fff2cc',
  '#d9ead3',
  '#d0e0e3',
  '#c9daf8',
  '#cfe2f3',
  '#d9d2e9',
  '#ead1dc',
  '#dd7e6b',
  '#ea9999',
  '#f9cb9c',
  '#ffe599',
  '#b6d7a8',
  '#a2c4c9',
  '#a4c2f4',
  '#9fc5e8',
  '#b4a7d6',
  '#d5a6bd',
];

// Highlight colors
const HIGHLIGHT_COLORS = [
  '#ffeb3b',
  '#ffc107',
  '#ff9800',
  '#ff5722',
  '#f44336',
  '#e91e63',
  '#9c27b0',
  '#673ab7',
  '#3f51b5',
  '#2196f3',
  '#03a9f4',
  '#00bcd4',
  '#009688',
  '#4caf50',
  '#8bc34a',
  '#cddc39',
  '#ffeb3b',
  '#ffffff',
  '#000000',
  '#424242',
];

export const EmailEditorToolbar: React.FC<EmailEditorToolbarProps> = ({
  editor,
  rightSlot,
  bubble = false,
}) => {
  const [isActive, setIsActive] = useState({
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    bulletList: false,
    orderedList: false,
    blockquote: false,
    link: false,
  });

  const [currentFontFamily, setCurrentFontFamily] = useState('');
  const [currentFontSize, setCurrentFontSize] = useState('');

  useEffect(() => {
    if (!editor) return;

    const updateAttributes = (): void => {
      const attrs = editor.getAttributes('textStyle');
      setCurrentFontFamily((attrs['fontFamily'] as string) || '');
      setCurrentFontSize((attrs['fontSize'] as string) || '');
    };

    updateAttributes();
    editor.on('transaction', updateAttributes);

    return (): void => {
      editor.off('transaction', updateAttributes);
    };
  }, [editor]);

  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [hasSelection, setHasSelection] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const linkSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const linkClickedRef = useRef(false);

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const onMouseDown = (e: MouseEvent): void => {
      linkClickedRef.current = !!(e.target as HTMLElement).closest('a[href]');
    };
    dom.addEventListener('mousedown', onMouseDown);
    return (): void => dom.removeEventListener('mousedown', onMouseDown);
  }, [editor]);

  React.useEffect(() => {
    if (!editor) return;

    const updateActiveStates = (): void => {
      const next = {
        bold: editor.isActive('bold'),
        italic: editor.isActive('italic'),
        underline: editor.isActive('underline'),
        strike: editor.isActive('strike'),
        bulletList: editor.isActive('bulletList'),
        orderedList: editor.isActive('orderedList'),
        blockquote: editor.isActive('blockquote'),
        link: editor.isActive('link'),
      };
      setIsActive(prev =>
        (Object.keys(next) as (keyof typeof next)[]).every(k => prev[k] === next[k]) ? prev : next,
      );
    };

    updateActiveStates();
    editor.on('transaction', updateActiveStates);

    return (): void => {
      editor.off('transaction', updateActiveStates);
    };
  }, [editor]);

  const buttonClass = useCallback(
    (active: boolean): string =>
      `p-1 rounded transition-all duration-200 ease-in-out ${
        active ? 'bg-muted text-primary' : 'hover:bg-accent text-muted-foreground'
      }`,
    [],
  );

  const handleBold = useCallback(() => {
    editor?.chain().focus().toggleBold().run();
  }, [editor]);

  const handleItalic = useCallback(() => {
    editor?.chain().focus().toggleItalic().run();
  }, [editor]);

  const handleUnderline = useCallback(() => {
    editor?.chain().focus().toggleUnderline().run();
  }, [editor]);

  const handleStrikethrough = useCallback(() => {
    editor?.chain().focus().toggleStrike().run();
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

  const handleTextAlign = useCallback(
    (align: 'left' | 'center' | 'right') => {
      editor?.chain().focus().setTextAlign(align).run();
    },
    [editor],
  );

  const handleFontSize = useCallback(
    (size: string) => {
      editor?.chain().focus().setFontSize(size).run();
    },
    [editor],
  );

  const handleFontFamily = useCallback(
    (family: string) => {
      editor?.chain().focus().setFontFamily(family).run();
    },
    [editor],
  );

  const handleTextColor = useCallback(
    (color: string) => {
      editor?.chain().focus().setColor(color).run();
    },
    [editor],
  );

  const handleHighlightColor = useCallback(
    (color: string) => {
      editor?.chain().focus().toggleHighlight({ color }).run();
    },
    [editor],
  );

  const clearFormatting = useCallback(() => {
    editor?.chain().focus().clearNodes().unsetAllMarks().run();
  }, [editor]);

  const handleLink = useCallback(() => {
    if (!editor) return;

    const { from, to } = editor.state.selection;
    let selectionRange = { from, to };
    let selectedText = editor.state.doc.textBetween(from, to);
    const previousUrl = editor.getAttributes('link')['href'] as string | undefined;

    if (editor.isActive('link')) {
      editor.chain().extendMarkRange('link').run();
      const { from: newFrom, to: newTo } = editor.state.selection;
      selectionRange = { from: newFrom, to: newTo };
      selectedText = editor.state.doc.textBetween(newFrom, newTo);
    }

    linkSelectionRef.current = selectionRange;
    setHasSelection(selectedText.length > 0);
    setLinkText(selectedText);
    setLinkUrl(previousUrl || '');
    setLinkDialogOpen(true);
  }, [editor]);

  const applyLink = useCallback(() => {
    if (!editor || !linkUrl.trim()) return;

    let finalUrl = linkUrl.trim();
    if (!/^https?:\/\//i.test(finalUrl)) {
      finalUrl = `https://${finalUrl}`;
    }

    const selectionRange = linkSelectionRef.current ?? editor.state.selection;
    const { from, to } = selectionRange;
    const selectedText = from === to ? '' : editor.state.doc.textBetween(from, to);
    const textToInsert = linkText.trim() || (hasSelection ? selectedText : linkUrl.trim());
    const linkEnd = from + textToInsert.length;

    const chain = editor
      .chain()
      .focus()
      .insertContentAt({ from, to }, textToInsert)
      .setTextSelection({ from, to: linkEnd })
      .setLink({ href: finalUrl })
      .setTextSelection(linkEnd);

    if (!hasSelection) {
      chain.insertContent(' ');
    }

    chain.run();

    setLinkDialogOpen(false);
    setLinkText('');
    setLinkUrl('');
    linkSelectionRef.current = null;
  }, [editor, linkUrl, linkText, hasSelection]);

  const removeLink = useCallback(() => {
    editor?.chain().focus().extendMarkRange('link').unsetLink().run();
    setLinkDialogOpen(false);
    linkSelectionRef.current = null;
  }, [editor]);

  if (!editor) return null;

  const formattingToolbar = (
    <div className='flex items-center gap-0.5 flex-wrap p-1'>
      {/* Font Family Dropdown */}
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type='button'
            className='flex items-center gap-1 px-1.5 py-1 rounded text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors w-[96px] shrink-0 overflow-hidden'
            title='Font Family'
            data-track-category='email-editor'
            data-track-name='open-font-family-dropdown'
          >
            <Type className='h-3.5 w-3.5 shrink-0' />
            <span className='flex-1 min-w-0 truncate'>
              {currentFontFamily
                ? (FONT_FAMILIES.find(f => f.value === currentFontFamily)?.label ?? 'Font')
                : 'Font'}
            </span>
            <ChevronDown className='h-3 w-3 shrink-0' />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className='z-50 min-w-[160px] bg-popover border border-border rounded-lg shadow-lg p-1'
            sideOffset={4}
            align='start'
          >
            {FONT_FAMILIES.map(font => (
              <button
                key={font.label}
                type='button'
                onClick={() => handleFontFamily(font.value)}
                className={`w-full text-left px-3 py-1.5 text-sm rounded transition-colors ${
                  currentFontFamily === font.value
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground hover:bg-accent'
                }`}
                style={font.value ? { fontFamily: font.value } : undefined}
                data-track-category='email-editor'
                data-track-name='select-font-family'
                data-track-metadata={JSON.stringify({ font: font.label })}
              >
                {font.label}
              </button>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {/* Font Size Dropdown */}
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type='button'
            className='flex items-center gap-1 px-1.5 py-1 rounded text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors w-[56px] shrink-0 overflow-hidden'
            title='Font Size'
            data-track-category='email-editor'
            data-track-name='open-font-size-dropdown'
          >
            <span className='flex-1 min-w-0 truncate'>
              {currentFontSize
                ? (FONT_SIZES.find(s => s.value === currentFontSize)?.label ?? 'Size')
                : 'Size'}
            </span>
            <ChevronDown className='h-3 w-3 shrink-0' />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className='z-50 min-w-[80px] bg-popover border border-border rounded-lg shadow-lg p-1'
            sideOffset={4}
            align='start'
          >
            {FONT_SIZES.map(size => (
              <button
                key={size.value}
                type='button'
                onClick={() => handleFontSize(size.value)}
                className={`w-full text-left px-3 py-1.5 text-sm rounded transition-colors ${
                  currentFontSize === size.value
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground hover:bg-accent'
                }`}
                style={{ fontSize: size.value }}
                data-track-category='email-editor'
                data-track-name='select-font-size'
                data-track-metadata={JSON.stringify({ size: size.label })}
              >
                {size.label}
              </button>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <div className='w-px h-4 bg-border mx-0.5' />

      {/* Bold, Italic, Underline, Strikethrough */}
      <Tooltip content='Bold (⌘B)'>
        <button
          type='button'
          onClick={handleBold}
          className={buttonClass(isActive.bold)}
          aria-label='Bold'
          aria-pressed={isActive.bold}
          data-track-category='email-editor'
          data-track-name='toggle-bold'
        >
          <Bold className='h-3.5 w-3.5' />
        </button>
      </Tooltip>

      <Tooltip content='Italic (⌘I)'>
        <button
          type='button'
          onClick={handleItalic}
          className={buttonClass(isActive.italic)}
          aria-label='Italic'
          aria-pressed={isActive.italic}
          data-track-category='email-editor'
          data-track-name='toggle-italic'
        >
          <Italic className='h-3.5 w-3.5' />
        </button>
      </Tooltip>

      <Tooltip content='Underline (⌘U)'>
        <button
          type='button'
          onClick={handleUnderline}
          className={buttonClass(isActive.underline)}
          aria-label='Underline'
          aria-pressed={isActive.underline}
          data-track-category='email-editor'
          data-track-name='toggle-underline'
        >
          <Underline className='h-3.5 w-3.5' />
        </button>
      </Tooltip>

      <Tooltip content='Strikethrough (⌘⇧X)'>
        <button
          type='button'
          onClick={handleStrikethrough}
          className={buttonClass(isActive.strike)}
          aria-label='Strikethrough'
          aria-pressed={isActive.strike}
          data-track-category='email-editor'
          data-track-name='toggle-strikethrough'
        >
          <Strikethrough className='h-3.5 w-3.5' />
        </button>
      </Tooltip>

      <div className='w-px h-4 bg-border mx-0.5' />

      {/* Text Color Picker */}
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type='button'
            className='p-1 rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors'
            title='Text Color'
            data-track-category='email-editor'
            data-track-name='open-text-color-picker'
          >
            <Palette className='h-3.5 w-3.5' />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className='z-50 bg-popover border border-border rounded-lg shadow-lg p-3'
            sideOffset={4}
            align='start'
          >
            <div className='grid grid-cols-10 gap-1'>
              {TEXT_COLORS.map(color => (
                <button
                  key={color}
                  type='button'
                  onClick={() => handleTextColor(color)}
                  className='w-5 h-5 rounded border border-border hover:scale-110 transition-transform'
                  style={{ backgroundColor: color }}
                  title={color}
                  data-track-category='email-editor'
                  data-track-name='select-text-color'
                  data-track-metadata={JSON.stringify({ color })}
                />
              ))}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {/* Highlight Color Picker */}
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type='button'
            className='p-1 rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors'
            title='Highlight Color'
            data-track-category='email-editor'
            data-track-name='open-highlight-color-picker'
          >
            <Highlighter className='h-3.5 w-3.5' />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className='z-50 bg-popover border border-border rounded-lg shadow-lg p-3'
            sideOffset={4}
            align='start'
          >
            <div className='grid grid-cols-5 gap-1.5'>
              {HIGHLIGHT_COLORS.map(color => (
                <button
                  key={color}
                  type='button'
                  onClick={() => handleHighlightColor(color)}
                  className='w-6 h-6 rounded border border-border hover:scale-110 transition-transform'
                  style={{ backgroundColor: color }}
                  title={color}
                  data-track-category='email-editor'
                  data-track-name='select-highlight-color'
                  data-track-metadata={JSON.stringify({ color })}
                />
              ))}
            </div>
            <button
              type='button'
              onClick={() => editor.chain().focus().unsetHighlight().run()}
              className='mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground py-1 border-t border-border'
              data-track-category='email-editor'
              data-track-name='remove-highlight'
            >
              Remove highlight
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <div className='w-px h-4 bg-border mx-0.5' />

      {/* Text Alignment */}
      <Tooltip content='Align Left'>
        <button
          type='button'
          onClick={() => handleTextAlign('left')}
          className={buttonClass(editor.isActive({ textAlign: 'left' }))}
          aria-label='Align left'
          data-track-category='email-editor'
          data-track-name='align-left'
        >
          <AlignLeft className='h-3.5 w-3.5' />
        </button>
      </Tooltip>

      <Tooltip content='Align Center'>
        <button
          type='button'
          onClick={() => handleTextAlign('center')}
          className={buttonClass(editor.isActive({ textAlign: 'center' }))}
          aria-label='Align center'
          data-track-category='email-editor'
          data-track-name='align-center'
        >
          <AlignCenter className='h-3.5 w-3.5' />
        </button>
      </Tooltip>

      <Tooltip content='Align Right'>
        <button
          type='button'
          onClick={() => handleTextAlign('right')}
          className={buttonClass(editor.isActive({ textAlign: 'right' }))}
          aria-label='Align right'
          data-track-category='email-editor'
          data-track-name='align-right'
        >
          <AlignRight className='h-3.5 w-3.5' />
        </button>
      </Tooltip>

      <div className='w-px h-4 bg-border mx-0.5' />

      {/* Bullet List */}
      <Tooltip content='Bullet List'>
        <button
          type='button'
          onClick={handleBulletList}
          className={buttonClass(isActive.bulletList)}
          aria-label='Bullet list'
          aria-pressed={isActive.bulletList}
          data-track-category='email-editor'
          data-track-name='toggle-bullet-list'
        >
          <List className='h-3.5 w-3.5' />
        </button>
      </Tooltip>

      {/* Numbered List */}
      <Tooltip content='Numbered List'>
        <button
          type='button'
          onClick={handleOrderedList}
          className={buttonClass(isActive.orderedList)}
          aria-label='Numbered list'
          aria-pressed={isActive.orderedList}
          data-track-category='email-editor'
          data-track-name='toggle-ordered-list'
        >
          <ListOrdered className='h-3.5 w-3.5' />
        </button>
      </Tooltip>

      {/* Blockquote */}
      <Tooltip content='Quote'>
        <button
          type='button'
          onClick={handleBlockquote}
          className={buttonClass(isActive.blockquote)}
          aria-label='Quote'
          aria-pressed={isActive.blockquote}
          data-track-category='email-editor'
          data-track-name='toggle-blockquote'
        >
          <TextQuote className='h-3.5 w-3.5' />
        </button>
      </Tooltip>

      <div className='w-px h-4 bg-border mx-0.5' />

      {/* Link Dialog */}
      <Dialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        trigger={
          <Tooltip content='Insert Link (⌘K)'>
            <button
              type='button'
              onClick={handleLink}
              className={buttonClass(isActive.link)}
              aria-label='Insert link'
              aria-pressed={isActive.link}
              data-track-category='email-editor'
              data-track-name='open-link-dialog'
            >
              <Link className='h-3.5 w-3.5' />
            </button>
          </Tooltip>
        }
        title={hasSelection ? 'Edit link' : 'Insert link'}
        className='p-4 w-96 backdrop-blur-none'
      >
        <div className='space-y-3'>
          <div className='flex items-center justify-between'>
            <h2 className='text-sm font-medium text-foreground'>
              {hasSelection ? 'Edit link' : 'Insert link'}
            </h2>
            <button
              onClick={() => setLinkDialogOpen(false)}
              className='p-1 hover:bg-accent rounded text-muted-foreground hover:text-muted-foreground'
              data-track-category='email-editor'
              data-track-name='close-link-dialog'
            >
              <X className='h-4 w-4' />
            </button>
          </div>

          <div>
            <input
              type='text'
              value={linkText}
              onChange={e => setLinkText(e.target.value)}
              placeholder='Link text'
              autoFocus // eslint-disable-line jsx-a11y/no-autofocus
              className='w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
              data-track-category='email-editor'
              data-track-name='edit-link-text'
            />
          </div>

          <div>
            <input
              type='url'
              value={linkUrl}
              onChange={e => setLinkUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && applyLink()}
              placeholder='https://example.com'
              className='w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
              data-track-category='email-editor'
              data-track-name='edit-link-url'
            />
          </div>

          <div className='flex items-center justify-between pt-2'>
            {isActive.link && (
              <Button
                onClick={removeLink}
                data-track-category='email-editor'
                data-track-name='REMOVE_LINK'
                className='rounded px-2 py-1 text-xs text-red-500 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400 dark:hover:bg-red-400/10 dark:hover:text-red-300'
                variant='ghost'
              >
                Remove
              </Button>
            )}
            <div className='flex gap-2 ml-auto'>
              <Button
                onClick={() => setLinkDialogOpen(false)}
                data-track-category='email-editor'
                data-track-name='CANCEL_LINK'
                variant='secondary'
                className='rounded px-3 py-1.5 text-xs text-foreground'
              >
                Cancel
              </Button>
              <Button
                onClick={applyLink}
                data-track-category='email-editor'
                data-track-name='APPLY_LINK'
                disabled={!linkUrl.trim()}
                className='rounded bg-primary px-3 py-1.5 text-xs text-white disabled:opacity-50 disabled:text-white'
              >
                {hasSelection && isActive.link ? 'Update' : 'Apply'}
              </Button>
            </div>
          </div>
        </div>
      </Dialog>

      <div className='w-px h-4 bg-border mx-0.5' />

      {/* Clear Formatting */}
      <Tooltip content='Clear Formatting'>
        <button
          type='button'
          onClick={clearFormatting}
          className='p-1 rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors'
          aria-label='Clear formatting'
          data-track-category='email-editor'
          data-track-name='clear-formatting'
        >
          <RemoveFormatting className='h-3.5 w-3.5' />
        </button>
      </Tooltip>

      {rightSlot && <div className='ml-auto flex items-center gap-1'>{rightSlot}</div>}
    </div>
  );

  return (
    <>
      {bubble ? (
        <BubbleMenu
          editor={editor}
          pluginKey='emailFormattingBubble'
          shouldShow={({ editor: e, from, to }) =>
            from !== to && !(e.isActive('link') && linkClickedRef.current)
          }
          options={{ placement: 'top', offset: 8, flip: true, shift: { padding: 8 } }}
          className='z-50'
        >
          <div className='max-w-[520px] overflow-hidden rounded-[10px] border border-border bg-popover/95 p-[3px] text-popover-foreground shadow-lg backdrop-blur-md'>
            {formattingToolbar}
          </div>
        </BubbleMenu>
      ) : (
        formattingToolbar
      )}
      <BubbleMenu
        editor={editor}
        shouldShow={({ editor: e }) => e.isActive('link') && linkClickedRef.current}
        options={{ placement: 'bottom-start', flip: false }}
      >
        <div className='bg-popover border border-border rounded-lg shadow-lg px-3 py-2 flex items-center gap-2'>
          <span className='text-xs text-muted-foreground whitespace-nowrap'>Go to link</span>
          <a
            href={editor.getAttributes('link')['href'] as string}
            target='_blank'
            rel='noopener noreferrer'
            className='text-xs text-blue-500 hover:underline max-w-[220px] truncate'
            title={editor.getAttributes('link')['href'] as string}
          >
            {editor.getAttributes('link')['href'] as string}
          </a>
          <div className='w-px h-4 bg-border mx-0.5 shrink-0' />
          <button
            type='button'
            onMouseDown={e => {
              e.preventDefault();
              handleLink();
            }}
            className='text-xs text-muted-foreground hover:text-foreground whitespace-nowrap'
          >
            Change
          </button>
          <div className='w-px h-4 bg-border mx-0.5 shrink-0' />
          <button
            type='button'
            onMouseDown={e => {
              e.preventDefault();
              removeLink();
            }}
            className='text-xs text-red-500 hover:text-red-600 whitespace-nowrap'
          >
            Remove
          </button>
        </div>
      </BubbleMenu>
    </>
  );
};
