import { useCallback, useEffect, useState } from 'react';
import { Tooltip } from '../Tooltip';
import { Bold, Italic, Code, FileCode, Link, List, ListOrdered, TextQuote, X } from 'lucide-react';
import type { EditorToolbarProps } from './EditorToolbar.types';
import Dialog from '../Dialog';
import Button from '../Button';

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
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [hasSelection, setHasSelection] = useState(false);
  const [open, setOpen] = useState(false);

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

    const { from, to } = editor.state.selection;
    let selectedText = editor.state.doc.textBetween(from, to);
    const previousUrl = editor.getAttributes('link')['href'] as string | undefined;

    // If we're inside an existing link
    if (editor.isActive('link')) {
      editor.chain().extendMarkRange('link').run();
      const { from: newFrom, to: newTo } = editor.state.selection;
      selectedText = editor.state.doc.textBetween(newFrom, newTo);
    }

    const hasTextSelected = selectedText.length > 0;
    setHasSelection(hasTextSelected);
    setLinkText(selectedText);
    setLinkUrl(previousUrl || '');
    setOpen(true);
  }, [editor]);

  const applyLink = useCallback(() => {
    if (!editor || !linkUrl.trim()) return;

    // if no protocol is specified
    let finalUrl = linkUrl.trim();
    if (!/^https?:\/\//i.test(finalUrl)) {
      finalUrl = `https://${finalUrl}`;
    }

    const { from, to } = editor.state.selection;
    const textToInsert =
      linkText.trim() || (hasSelection ? editor.state.doc.textBetween(from, to) : linkUrl);

    if (hasSelection) {
      editor
        .chain()
        .focus()
        .deleteRange({ from, to })
        .insertContent({
          type: 'text',
          text: textToInsert,
          marks: [{ type: 'link', attrs: { href: finalUrl } }],
        })
        .run();
    } else {
      const currentPos = from;
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'text',
          text: textToInsert,
          marks: [{ type: 'link', attrs: { href: finalUrl } }],
        })
        .insertContent(' ')
        .setTextSelection(currentPos + textToInsert.length)
        .run();
    }

    setOpen(false);
    setLinkText('');
    setLinkUrl('');
  }, [editor, linkUrl, linkText, hasSelection]);

  const removeLink = useCallback(() => {
    editor?.chain().focus().extendMarkRange('link').unsetLink().run();
    setOpen(false);
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
      active ? 'bg-blue-100 text-primary' : 'hover:bg-accent text-muted-foreground'
    }`;

  return (
    <>
      {/* Link Hover Tooltip */}
      <div className='border-border p-1'>
        <div className='flex items-center gap-1 px-3 py-2 bg-muted rounded-xl'>
          <Tooltip content='Bold (⌘B)'>
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

          <Tooltip content='Italic (⌘I)'>
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

          <Tooltip content='Inline Code (⌘E)'>
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

          <Tooltip content='Code Block (⌘⇧E)'>
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

          <Dialog
            open={open}
            onOpenChange={setOpen}
            trigger={
              <Tooltip content='Insert Link (⌘K)'>
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
                  onClick={() => setOpen(false)}
                  className='p-1 hover:bg-accent rounded text-muted-foreground hover:text-muted-foreground'
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
                  className='w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring'
                />
              </div>

              <div>
                <input
                  type='url'
                  value={linkUrl}
                  onChange={e => setLinkUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && applyLink()}
                  placeholder='https://example.com'
                  className='w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring'
                />
              </div>

              <div className='flex items-center justify-between pt-2'>
                {isActive.link && (
                  <Button
                    onClick={removeLink}
                    className='text-xs text-red-500 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50'
                    variant='ghost'
                  >
                    Remove
                  </Button>
                )}
                <div className='flex gap-2 ml-auto'>
                  <Button
                    onClick={() => setOpen(false)}
                    variant='secondary'
                    className='px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent rounded'
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={applyLink}
                    disabled={!linkUrl.trim()}
                    className='px-3 py-1.5 text-xs bg-sidebar-badge-accent text-white rounded disabled:opacity-50'
                  >
                    {hasSelection && isActive.link ? 'Update' : 'Apply'}
                  </Button>
                </div>
              </div>
            </div>
          </Dialog>

          <Tooltip content='Blockquote (⌘⇧B)'>
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

          <Tooltip content='Bullet List'>
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

          <Tooltip content='Numbered List'>
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
    </>
  );
};
