import { useCallback, useEffect, useRef, useState } from 'react';
import { Tooltip } from '../Tooltip';
import {
  Bold,
  CheckTickSquare,
  Italic,
  Underline as UnderlineIcon,
  Code,
  FileCode,
  PhotoImageDefault,
  LinkSlant,
  ListDefault,
  ListNumber,
  StrikeThrough,
  TextClear,
  TextQuote,
  MultipleCrossCancelDefault,
} from '@xyne/icons';
import { Highlighter } from 'lucide-react';
import type { EditorToolbarProps } from './EditorToolbar.types';
import Dialog from '../Dialog';
import Button from '../Button';

export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  editor,
  showImageUpload = false,
  rightSlot,
  variant = 'default',
}) => {
  const [isActive, setIsActive] = useState({
    bold: false,
    italic: false,
    strike: false,
    underline: false,
    highlight: false,
    code: false,
    codeBlock: false,
    link: false,
    blockquote: false,
    bulletList: false,
    orderedList: false,
    taskList: false,
  });
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [hasSelection, setHasSelection] = useState(false);
  const linkSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [imageTab, setImageTab] = useState<'url' | 'upload'>('upload');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagePopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor) return;

    const updateActiveStates = (): void => {
      setIsActive({
        bold: editor.isActive('bold'),
        italic: editor.isActive('italic'),
        strike: editor.isActive('strike'),
        underline: editor.isActive('underline'),
        highlight: editor.isActive('highlight'),
        code: editor.isActive('code'),
        codeBlock: editor.isActive('codeBlock'),
        link: editor.isActive('link'),
        blockquote: editor.isActive('blockquote'),
        bulletList: editor.isActive('bulletList'),
        orderedList: editor.isActive('orderedList'),
        taskList: editor.isActive('taskList'),
      });
    };

    updateActiveStates();
    editor.on('transaction', updateActiveStates);

    return (): void => {
      editor.off('transaction', updateActiveStates);
    };
  }, [editor]);

  useEffect(() => {
    if (!imageOpen) return;
    const handler = (e: MouseEvent): void => {
      if (imagePopoverRef.current && !imagePopoverRef.current.contains(e.target as Node)) {
        setImageOpen(false);
        setImageUrl('');
      }
    };
    document.addEventListener('mousedown', handler);
    return (): void => document.removeEventListener('mousedown', handler);
  }, [imageOpen]);

  const handleBold = useCallback(() => {
    editor?.chain().focus().toggleBold().run();
  }, [editor]);

  const handleItalic = useCallback(() => {
    editor?.chain().focus().toggleItalic().run();
  }, [editor]);

  const handleStrikethrough = useCallback(() => {
    editor?.chain().focus().toggleStrike().run();
  }, [editor]);

  const handleClearFormatting = useCallback(() => {
    editor?.chain().focus().clearNodes().unsetAllMarks().run();
  }, [editor]);

  const handleUnderline = useCallback(() => {
    editor?.chain().focus().toggleUnderline().run();
  }, [editor]);

  const handleHighlight = useCallback(() => {
    editor?.chain().focus().toggleHighlight().run();
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

    if (editor.isActive('link')) {
      editor.chain().focus().extendMarkRange('link').run();
    }

    const { from, to } = editor.state.selection;
    let selectionRange = { from, to };
    let selectedText = editor.state.doc.textBetween(from, to);
    const previousUrl = editor.getAttributes('link')['href'] as string | undefined;

    // If we're inside an existing link
    if (editor.isActive('link')) {
      editor.chain().extendMarkRange('link').run();
      const { from: newFrom, to: newTo } = editor.state.selection;
      selectionRange = { from: newFrom, to: newTo };
      selectedText = editor.state.doc.textBetween(newFrom, newTo);
    }

    linkSelectionRef.current = selectionRange;
    const hasTextSelected = selectedText.length > 0;
    setHasSelection(hasTextSelected);
    setLinkText(selectedText);
    setLinkUrl(previousUrl || '');
    setOpen(true);
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

    setOpen(false);
    setLinkText('');
    setLinkUrl('');
    linkSelectionRef.current = null;
  }, [editor, linkUrl, linkText, hasSelection]);

  const removeLink = useCallback(() => {
    editor?.chain().focus().extendMarkRange('link').unsetLink().run();
    setOpen(false);
    linkSelectionRef.current = null;
  }, [editor]);

  const handleBulletList = useCallback(() => {
    editor?.chain().focus().toggleBulletList().run();
  }, [editor]);

  const handleOrderedList = useCallback(() => {
    editor?.chain().focus().toggleOrderedList().run();
  }, [editor]);

  const handleTaskList = useCallback(() => {
    if (!editor?.extensionManager.extensions.some(ext => ext.name === 'taskList')) return;
    editor.chain().focus().toggleTaskList().run();
  }, [editor]);

  const hasTaskListExtension = Boolean(
    editor?.extensionManager.extensions.some(ext => ext.name === 'taskList'),
  );

  const handleBlockquote = useCallback(() => {
    editor?.chain().focus().toggleBlockquote().run();
  }, [editor]);

  const insertImageFromUrl = useCallback(() => {
    if (!editor || !imageUrl.trim()) return;
    editor.chain().focus().setImage({ src: imageUrl.trim() }).run();
    setImageUrl('');
    setImageOpen(false);
  }, [editor, imageUrl]);

  const handleImageFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !editor) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const src = ev.target?.result as string;
        editor.chain().focus().setImage({ src }).run();
        setImageOpen(false);
      };
      reader.readAsDataURL(file);
      // reset so the same file can be re-selected
      e.target.value = '';
    },
    [editor],
  );

  if (!editor) return null;

  const supportsHighlight = editor.extensionManager.extensions.some(
    extension => extension.name === 'highlight',
  );

  const buttonClass = (active: boolean): string =>
    variant === 'compact'
      ? `pt-[6px] pr-[8px] pb-[7px] pl-[8px] rounded transition-all duration-200 ease-in-out ${
          active ? 'bg-muted text-primary' : 'hover:bg-accent text-muted-foreground'
        }`
      : `p-1.5 rounded transition-all duration-200 ease-in-out ${
          active ? 'bg-muted text-primary' : 'hover:bg-accent text-muted-foreground'
        }`;

  return (
    <>
      {/* Link Hover Tooltip */}
      <div className='border-border'>
        <div
          className={
            variant === 'compact'
              ? 'flex items-center gap-[10px] px-3 py-2 rounded-xl'
              : 'flex items-center gap-1 px-1.5 pt-2 rounded-t-xl'
          }
        >
          <Tooltip content='Bold (⌘B)' delayDuration={1000} skipDelayDuration={1000}>
            <button
              type='button'
              onClick={handleBold}
              data-track-category='EDITOR_TOOLBAR'
              data-track-name='FORMAT_BOLD'
              onMouseDown={e => e.preventDefault()}
              className={buttonClass(isActive.bold)}
              aria-label='Bold'
              aria-pressed={isActive.bold}
            >
              <Bold className='h-4 w-4' />
            </button>
          </Tooltip>

          <Tooltip content='Italic (⌘I)' delayDuration={1000} skipDelayDuration={1000}>
            <button
              type='button'
              onClick={handleItalic}
              data-track-category='EDITOR_TOOLBAR'
              data-track-name='FORMAT_ITALIC'
              className={buttonClass(isActive.italic)}
              aria-label='Italic'
              aria-pressed={isActive.italic}
            >
              <Italic className='h-4 w-4' />
            </button>
          </Tooltip>

          <Tooltip content='Underline (⌘U)' delayDuration={1000} skipDelayDuration={1000}>
            <button
              type='button'
              onClick={handleUnderline}
              data-track-category='EDITOR_TOOLBAR'
              data-track-name='FORMAT_UNDERLINE'
              className={buttonClass(isActive.underline)}
              aria-label='Underline'
              aria-pressed={isActive.underline}
            >
              <UnderlineIcon className='h-4 w-4' />
            </button>
          </Tooltip>

          <Tooltip content='Strikethrough (⌘⇧X)' delayDuration={1000} skipDelayDuration={1000}>
            <button
              type='button'
              onClick={handleStrikethrough}
              data-track-category='EDITOR_TOOLBAR'
              data-track-name='FORMAT_STRIKETHROUGH'
              className={buttonClass(isActive.strike)}
              aria-label='Strikethrough'
              aria-pressed={isActive.strike}
            >
              <StrikeThrough className='h-4 w-4' />
            </button>
          </Tooltip>

          {supportsHighlight && (
            <Tooltip content='Highlight (⌘⇧H)' delayDuration={1000} skipDelayDuration={1000}>
              <button
                type='button'
                onClick={handleHighlight}
                data-track-category='EDITOR_TOOLBAR'
                data-track-name='FORMAT_HIGHLIGHT'
                onMouseDown={e => e.preventDefault()}
                className={buttonClass(isActive.highlight)}
                aria-label='Highlight'
                aria-pressed={isActive.highlight}
              >
                <Highlighter className='h-4 w-4' />
              </button>
            </Tooltip>
          )}

          <Tooltip content='Clear Formatting (⌘\\)' delayDuration={1000} skipDelayDuration={1000}>
            <button
              type='button'
              onClick={handleClearFormatting}
              data-track-category='EDITOR_TOOLBAR'
              data-track-name='CLEAR_FORMATTING'
              onMouseDown={e => e.preventDefault()}
              className={buttonClass(false)}
              aria-label='Clear formatting'
            >
              <TextClear className='h-4 w-4' />
            </button>
          </Tooltip>

          {variant === 'default' && (
            <>
              <Tooltip content='Inline Code (⌘E)' delayDuration={1000} skipDelayDuration={1000}>
                <button
                  type='button'
                  onClick={handleCode}
                  data-track-category='EDITOR_TOOLBAR'
                  data-track-name='FORMAT_INLINE_CODE'
                  onMouseDown={e => e.preventDefault()}
                  className={buttonClass(isActive.code)}
                  aria-label='Inline code'
                  aria-pressed={isActive.code}
                >
                  <Code className='h-4 w-4' />
                </button>
              </Tooltip>

              <Tooltip content='Code Block (⌘⇧E)' delayDuration={1000} skipDelayDuration={1000}>
                <button
                  type='button'
                  onClick={handleCodeBlock}
                  data-track-category='EDITOR_TOOLBAR'
                  data-track-name='FORMAT_CODE_BLOCK'
                  className={buttonClass(isActive.codeBlock)}
                  aria-label='Code block'
                  aria-pressed={isActive.codeBlock}
                >
                  <FileCode className='h-4 w-4' />
                </button>
              </Tooltip>
            </>
          )}

          {variant === 'compact' && <div className='w-px h-4 bg-border' />}

          <Dialog
            open={open}
            onOpenChange={setOpen}
            trigger={
              <Tooltip content='Insert Link (⌘K)' delayDuration={1000} skipDelayDuration={1000}>
                <button
                  type='button'
                  onClick={handleLink}
                  data-track-category='EDITOR_TOOLBAR'
                  data-track-name='OPEN_LINK_DIALOG'
                  className={buttonClass(isActive.link)}
                  aria-label='Insert link'
                  aria-pressed={isActive.link}
                >
                  <LinkSlant className='h-4 w-4' />
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
                  data-track-category='EDITOR_TOOLBAR'
                  data-track-name='CLOSE_LINK_DIALOG'
                  className='p-1 hover:bg-accent rounded text-muted-foreground hover:text-muted-foreground'
                >
                  <MultipleCrossCancelDefault className='h-4 w-4' />
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
                />
              </div>

              <div className='flex items-center justify-between pt-2'>
                {isActive.link && (
                  <Button
                    onClick={removeLink}
                    data-track-category='EDITOR_TOOLBAR'
                    data-track-name='REMOVE_LINK'
                    className='rounded px-2 py-1 text-xs text-red-500 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400 dark:hover:bg-red-400/10 dark:hover:text-red-300'
                    variant='ghost'
                  >
                    Remove
                  </Button>
                )}
                <div className='flex gap-2 ml-auto'>
                  <Button
                    onClick={() => setOpen(false)}
                    data-track-category='EDITOR_TOOLBAR'
                    data-track-name='CANCEL_LINK'
                    variant='secondary'
                    className='rounded px-3 py-1.5 text-xs text-foreground'
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={applyLink}
                    data-track-category='EDITOR_TOOLBAR'
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

          {showImageUpload && (
            <div ref={imagePopoverRef} className='relative'>
              <input
                ref={fileInputRef}
                type='file'
                accept='image/*'
                className='hidden'
                onChange={handleImageFileChange}
              />
              <Tooltip content='Insert Image' delayDuration={1000} skipDelayDuration={1000}>
                <button
                  type='button'
                  onClick={() => {
                    setImageTab('upload');
                    setImageOpen(prev => !prev);
                  }}
                  data-track-category='EDITOR_TOOLBAR'
                  data-track-name='OPEN_IMAGE_MENU'
                  className={buttonClass(imageOpen)}
                  aria-label='Insert image'
                >
                  <PhotoImageDefault className='h-4 w-4' />
                </button>
              </Tooltip>

              {imageOpen && (
                <div className='absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-xl shadow-lg w-64 overflow-hidden'>
                  {/* Tabs */}
                  <div className='flex border-b border-border'>
                    <button
                      type='button'
                      onClick={() => setImageTab('upload')}
                      data-track-category='EDITOR_TOOLBAR'
                      data-track-name='IMAGE_TAB_UPLOAD'
                      className={`flex-1 py-2 text-xs font-medium transition-colors ${imageTab === 'upload' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      Upload
                    </button>
                    <button
                      type='button'
                      onClick={() => setImageTab('url')}
                      data-track-category='EDITOR_TOOLBAR'
                      data-track-name='IMAGE_TAB_URL'
                      className={`flex-1 py-2 text-xs font-medium transition-colors ${imageTab === 'url' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      URL
                    </button>
                  </div>

                  <div className='p-3'>
                    {imageTab === 'upload' ? (
                      <button
                        type='button'
                        onClick={() => fileInputRef.current?.click()}
                        data-track-category='EDITOR_TOOLBAR'
                        data-track-name='IMAGE_CHOOSE_FROM_DEVICE'
                        className='w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-accent rounded-lg transition-colors'
                      >
                        <PhotoImageDefault className='h-4 w-4 shrink-0' />
                        Choose from device
                      </button>
                    ) : (
                      <div className='space-y-2'>
                        <input
                          type='url'
                          value={imageUrl}
                          onChange={e => setImageUrl(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && insertImageFromUrl()}
                          placeholder='https://example.com/image.png'
                          autoFocus // eslint-disable-line jsx-a11y/no-autofocus
                          className='w-full px-2.5 py-1.5 text-xs border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring'
                        />
                        <button
                          type='button'
                          onClick={insertImageFromUrl}
                          data-track-category='EDITOR_TOOLBAR'
                          data-track-name='INSERT_IMAGE_FROM_URL'
                          disabled={!imageUrl.trim()}
                          className='w-full py-1.5 text-xs font-medium bg-primary text-white rounded-lg disabled:opacity-50 hover:opacity-90 transition-opacity'
                        >
                          Insert
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {variant === 'compact' && <div className='w-px h-4 bg-border' />}

          {variant === 'default' && (
            <Tooltip content='Blockquote (⌘⇧B)' delayDuration={1000} skipDelayDuration={1000}>
              <button
                type='button'
                onClick={handleBlockquote}
                data-track-category='EDITOR_TOOLBAR'
                data-track-name='FORMAT_BLOCKQUOTE'
                className={buttonClass(isActive.blockquote)}
                aria-label='Quote'
                aria-pressed={isActive.blockquote}
              >
                <TextQuote className='h-4 w-4' />
              </button>
            </Tooltip>
          )}

          <Tooltip content='Bullet List' delayDuration={1000} skipDelayDuration={1000}>
            <button
              type='button'
              onClick={handleBulletList}
              data-track-category='EDITOR_TOOLBAR'
              data-track-name='FORMAT_BULLET_LIST'
              className={buttonClass(isActive.bulletList)}
              aria-label='Bullet list'
              aria-pressed={isActive.bulletList}
            >
              <ListDefault className='h-4 w-4' />
            </button>
          </Tooltip>

          <Tooltip content='Numbered List' delayDuration={1000} skipDelayDuration={1000}>
            <button
              type='button'
              onClick={handleOrderedList}
              data-track-category='EDITOR_TOOLBAR'
              data-track-name='FORMAT_NUMBERED_LIST'
              className={buttonClass(isActive.orderedList)}
              aria-label='Numbered list'
              aria-pressed={isActive.orderedList}
            >
              <ListNumber className='h-4 w-4' />
            </button>
          </Tooltip>

          {rightSlot && (
            <>
              <div className='mx-1 h-4 w-px bg-border' />
              {rightSlot}
            </>
          )}

          {variant === 'compact' && hasTaskListExtension && (
            <Tooltip content='Task List' delayDuration={1000} skipDelayDuration={1000}>
              <button
                type='button'
                onClick={handleTaskList}
                data-track-category='EDITOR_TOOLBAR'
                data-track-name='FORMAT_TASK_LIST'
                className={buttonClass(isActive.taskList)}
                aria-label='Task list'
                aria-pressed={isActive.taskList}
              >
                <CheckTickSquare className='h-4 w-4' />
              </button>
            </Tooltip>
          )}

          {variant === 'compact' && (
            <Tooltip content='Blockquote (⌘⇧B)' delayDuration={1000} skipDelayDuration={1000}>
              <button
                type='button'
                onClick={handleBlockquote}
                data-track-category='EDITOR_TOOLBAR'
                data-track-name='FORMAT_BLOCKQUOTE'
                className={buttonClass(isActive.blockquote)}
                aria-label='Quote'
                aria-pressed={isActive.blockquote}
              >
                <TextQuote className='h-4 w-4' />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </>
  );
};
