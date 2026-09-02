import { JSX, useState } from 'react';
import Dialog from '../ui/Dialog';
import { Button } from '../ui/Button';
import type { EntityListItem } from '../../api/entitiesApi';

interface EntityRemarksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: EntityListItem;
  /** The message being reviewed — shown so the reviewer sees what they are judging. */
  messageText: string;
  saving: boolean;
  onConfirm: (remarks: string) => void;
}

const MAX_REMARKS = 1000;

/**
 * Captures why an entity was rejected.
 *
 * A remark is required rather than optional: a rejection with no reason tells a
 * later reviewer nothing, and the column exists precisely to carry that reason.
 *
 * The Dialog primitive renders `title`/`description` with `className='hidden'` —
 * they exist for screen readers only — and applies no padding to its content. Both
 * the visible heading and the padding therefore belong here, matching the house
 * pattern (StageFormConflictDialog.tsx:205).
 */
export const EntityRemarksDialog = ({
  open,
  onOpenChange,
  entity,
  messageText,
  saving,
  onConfirm,
}: EntityRemarksDialogProps): JSX.Element => {
  const [remarks, setRemarks] = useState('');
  const trimmed = remarks.trim();

  const close = (): void => {
    setRemarks('');
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={next => (next ? onOpenChange(true) : close())}
      title='Reject entity'
      description={`Why is "${entity.canonicalName}" wrong?`}
      className='max-w-md'
    >
      <div className='p-6'>
        <div className='mb-4'>
          <h2 className='text-base font-semibold text-foreground'>Reject on this message</h2>
          <p className='mt-1 text-sm text-muted-foreground'>
            Why is <span className='font-medium text-foreground'>{entity.canonicalName}</span> wrong
            here?
          </p>
          {messageText && (
            <p className='mt-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground line-clamp-3'>
              {messageText}
            </p>
          )}
        </div>

        <textarea
          value={remarks}
          onChange={event => setRemarks(event.target.value)}
          onKeyDown={event => {
            // Cmd/Ctrl+Enter submits; plain Enter stays a newline, since a remark
            // is often more than one line.
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && trimmed) {
              event.preventDefault();
              onConfirm(trimmed);
            }
          }}
          maxLength={MAX_REMARKS}
          rows={3}
          autoFocus
          placeholder='e.g. this is a product name, not a vendor'
          aria-label='Rejection remarks'
          data-track-category='Entities'
          data-track-name='EntityRemarksInput'
          className='w-full resize-none rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring'
        />

        <div className='mt-4 flex items-center justify-between gap-3'>
          <span className='text-xs text-muted-foreground tabular-nums'>
            {trimmed.length}/{MAX_REMARKS}
          </span>
          <div className='flex items-center gap-2'>
            <Button variant='ghost' size='sm' onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              size='sm'
              onClick={() => onConfirm(trimmed)}
              loading={saving}
              disabled={!trimmed}
            >
              Reject
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};

export default EntityRemarksDialog;
