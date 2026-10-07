import React, { useEffect, useRef, useState } from 'react';

/** Mirrors COLLECTION_REMARK_MAX_LENGTH in the collection Zero mutators. */
export const REMARK_MAX_LENGTH = 1000;

interface RemarkDialogV2Props {
  open: boolean;
  /** Name of the collection / folder whose remark is being edited. */
  targetName: string;
  /** Current remark — pre-fills the textarea. */
  initialValue?: string | null;
  /** Called with the trimmed remark ('' clears it). Throw to keep the dialog open. */
  onSubmit: (remark: string) => Promise<void>;
  onClose: () => void;
}

/**
 * Edit the free-text remark attached to a Knowledge Base collection or
 * folder. Remarks are stored in `collections.description` and saved through
 * the `collection.updateRemark` mutator (EDITOR+ on the root collection).
 */
export const RemarkDialogV2: React.FC<RemarkDialogV2Props> = ({
  open,
  targetName,
  initialValue,
  onSubmit,
  onClose,
}) => {
  const [value, setValue] = useState(initialValue ?? '');
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue ?? '');
      setSubmitting(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open, initialValue]);

  if (!open) return null;

  const unchanged = value.trim() === (initialValue ?? '').trim();

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (submitting || unchanged) return;
    setSubmitting(true);
    try {
      await onSubmit(value.trim());
    } catch {
      // Error surfaced by caller (toast)
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'>
      <div className='w-full max-w-md rounded-2xl border border-border bg-secondary p-6 shadow-xl'>
        <h2 className='text-lg font-semibold text-foreground'>Edit remark</h2>
        <p className='mt-1 truncate text-sm text-muted-foreground' title={targetName}>
          {`Add a note to "${targetName}". Leave empty to remove it.`}
        </p>
        <form
          onSubmit={(e): void => {
            void handleSubmit(e);
          }}
          className='mt-4'
        >
          <label className='block text-sm font-medium text-foreground' htmlFor='kb-remark-input'>
            Remark
          </label>
          <textarea
            id='kb-remark-input'
            ref={textareaRef}
            value={value}
            maxLength={REMARK_MAX_LENGTH}
            rows={4}
            onChange={e => setValue(e.target.value)}
            placeholder='e.g. Source of truth for Q3 onboarding docs'
            className='mt-1 block w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring'
            disabled={submitting}
            data-track-category='knowledge-base'
            data-track-name='remark-dialog-input'
          />
          <p className='mt-1 text-right text-xs text-muted-foreground'>
            {value.length}/{REMARK_MAX_LENGTH}
          </p>
          <div className='mt-4 flex justify-end gap-2'>
            <button
              type='button'
              onClick={onClose}
              disabled={submitting}
              className='rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:bg-secondary disabled:opacity-50'
              data-track-category='knowledge-base'
              data-track-name='remark-dialog-cancel'
            >
              Cancel
            </button>
            <button
              type='submit'
              disabled={submitting || unchanged}
              className='rounded-lg bg-muted-foreground px-4 py-2 text-sm font-medium text-background transition hover:bg-muted-foreground/90 disabled:opacity-50'
              data-track-category='knowledge-base'
              data-track-name='remark-dialog-submit'
            >
              {submitting ? 'Saving...' : 'Save remark'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
