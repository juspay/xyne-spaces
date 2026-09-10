import { useCallback, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { MultipleCrossCancelDefault } from '@xyne/icons';
import Dialog from '../Dialog';
import Button from '../Button';
import type { LinkDialogProps, LinkDialogState } from './EditorToolbar.types';

export const useLinkDialog = (editor: Editor | null): LinkDialogState => {
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [hasSelection, setHasSelection] = useState(false);
  const [isExistingLink, setIsExistingLink] = useState(false);
  const linkSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const [open, setOpen] = useState(false);

  const openDialog = useCallback(() => {
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
    setIsExistingLink(editor.isActive('link'));
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

  return {
    open,
    setOpen,
    linkUrl,
    setLinkUrl,
    linkText,
    setLinkText,
    hasSelection,
    isExistingLink,
    openDialog,
    applyLink,
    removeLink,
  };
};

export const LinkDialog: React.FC<LinkDialogProps> = ({
  trigger,
  open,
  setOpen,
  linkUrl,
  setLinkUrl,
  linkText,
  setLinkText,
  hasSelection,
  isExistingLink,
  applyLink,
  removeLink,
}) => (
  <Dialog
    open={open}
    onOpenChange={setOpen}
    {...(trigger !== undefined && { trigger })}
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
        {isExistingLink && (
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
            {hasSelection && isExistingLink ? 'Update' : 'Apply'}
          </Button>
        </div>
      </div>
    </div>
  </Dialog>
);
