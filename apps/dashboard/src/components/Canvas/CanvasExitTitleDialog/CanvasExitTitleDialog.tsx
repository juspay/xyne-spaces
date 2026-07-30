import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, Sparkles, Trash2 } from 'lucide-react';

import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import Input from '../../ui/Input';
import { MAX_CANVAS_TITLE_LENGTH } from '../../../utils/canvasTitleUtils';

interface CanvasExitTitleDialogProps {
  open: boolean;
  title: string;
  isGenerating: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  generationFailed: boolean;
  canDelete: boolean;
  onTitleChange: (title: string) => void;
  onKeepEditing: () => void;
  onSaveAndExit: () => void;
  onDelete: () => void;
  onRegenerate: () => void;
}

export function CanvasExitTitleDialog({
  open,
  title,
  isGenerating,
  isSaving,
  isDeleting,
  generationFailed,
  canDelete,
  onTitleChange,
  onKeepEditing,
  onSaveAndExit,
  onDelete,
  onRegenerate,
}: CanvasExitTitleDialogProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const busy = isSaving || isDeleting;
  const hasTitle = title.trim().length > 0;
  const handleSecondaryAction = (): void => {
    if (confirmDelete) setConfirmDelete(false);
    else onKeepEditing();
  };

  useEffect(() => {
    if (!open) setConfirmDelete(false);
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen && !busy) onKeepEditing();
      }}
      title='Name your canvas before leaving'
      description='Save an AI-generated or manually entered canvas title before leaving.'
      focusRef={inputRef}
      testId='canvas-exit-title-dialog'
    >
      <div className='space-y-5 p-6'>
        <div className='space-y-1'>
          <div className='flex items-center gap-2'>
            <Sparkles className='h-5 w-5 text-primary' />
            <h2 className='text-lg font-semibold'>Name your canvas before leaving</h2>
          </div>
          <p className='text-sm text-muted-foreground'>
            We will suggest a title, or you can type your own.
          </p>
        </div>

        {confirmDelete ? (
          <div className='rounded-md border border-destructive/30 bg-destructive/5 p-4'>
            <p className='font-medium'>Delete this canvas?</p>
            <p className='mt-1 text-sm text-muted-foreground'>This action cannot be undone.</p>
          </div>
        ) : (
          <div className='space-y-2'>
            <Input
              ref={inputRef}
              value={title}
              maxLength={MAX_CANVAS_TITLE_LENGTH}
              onChange={event => onTitleChange(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && hasTitle && !busy) onSaveAndExit();
              }}
              placeholder={isGenerating ? 'Generating a title…' : 'Enter canvas title'}
              aria-label='Canvas title before leaving'
              data-testid='canvas-exit-title-input'
            />
            <div className='flex min-h-5 items-center justify-between text-xs text-muted-foreground'>
              <span>
                {isGenerating && (
                  <span className='flex items-center gap-1'>
                    <Loader2 className='h-3 w-3 animate-spin' /> Generating title…
                  </span>
                )}
                {!isGenerating &&
                  generationFailed &&
                  'Could not generate a title. Type one or retry.'}
              </span>
              {!isGenerating && generationFailed && (
                <Button variant='ghost' size='sm' onClick={onRegenerate}>
                  <RefreshCw className='mr-1 h-3 w-3' /> Retry
                </Button>
              )}
            </div>
          </div>
        )}

        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            {canDelete && !confirmDelete && (
              <Button
                variant='ghost'
                className='hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20'
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
              >
                <Trash2 className='mr-2 h-4 w-4' /> Delete canvas
              </Button>
            )}
            {confirmDelete && (
              <Button variant='destructive' onClick={onDelete} disabled={busy}>
                {isDeleting && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
                Confirm delete
              </Button>
            )}
          </div>
          <div className='ml-auto flex gap-2'>
            <Button variant='secondary' onClick={handleSecondaryAction} disabled={busy}>
              {confirmDelete ? 'Back' : 'Keep editing'}
            </Button>
            {!confirmDelete && (
              <Button onClick={onSaveAndExit} disabled={!hasTitle || busy}>
                {isSaving && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
                Save title & exit
              </Button>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
