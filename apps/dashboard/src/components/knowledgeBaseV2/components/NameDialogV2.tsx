import React, { useState, useEffect, useRef } from 'react';

interface NameDialogV2Props {
  open: boolean;
  title: string;
  description?: string;
  label: string;
  placeholder?: string;
  helper?: string;
  submitLabel: string;
  /** Pre-fill the input on open. Used by the rename flow to show the
   *  current name; create flows omit this and the field starts empty. */
  initialValue?: string;
  /** Submit button copy while the request is in flight. Defaults to
   *  "Creating...". The rename flow overrides to "Renaming...". */
  submittingLabel?: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}

export const NameDialogV2: React.FC<NameDialogV2Props> = ({
  open,
  title,
  description,
  label,
  placeholder,
  helper,
  submitLabel,
  initialValue,
  submittingLabel,
  onSubmit,
  onClose,
}) => {
  const [name, setName] = useState(initialValue ?? '');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(initialValue ?? '');
      setSubmitting(false);
      // Focus on next tick after modal renders. Select-all so a rename
      // user can immediately overwrite the existing name.
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [open, initialValue]);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      setName('');
    } catch {
      // Error handled by caller (toast)
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'>
      <div className='w-full max-w-md rounded-2xl border border-border bg-secondary p-6 shadow-xl'>
        <h2 className='text-lg font-semibold text-foreground'>{title}</h2>
        {description ? <p className='mt-1 text-sm text-muted-foreground'>{description}</p> : null}

        <form
          onSubmit={(e): void => {
            void handleSubmit(e);
          }}
          className='mt-4'
        >
          <label className='block text-sm font-medium text-foreground'>{label}</label>
          <input
            ref={inputRef}
            type='text'
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={placeholder}
            className='mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring'
            disabled={submitting}
            data-track-category='knowledge-base'
            data-track-name='name-dialog-input'
          />
          {helper ? <p className='mt-1 text-xs text-muted-foreground'>{helper}</p> : null}

          <div className='mt-5 flex justify-end gap-2'>
            <button
              type='button'
              onClick={onClose}
              disabled={submitting}
              className='rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:bg-secondary disabled:opacity-50'
              data-track-category='knowledge-base'
              data-track-name='name-dialog-cancel'
            >
              Cancel
            </button>
            <button
              type='submit'
              disabled={!name.trim() || submitting}
              className='rounded-lg bg-muted-foreground px-4 py-2 text-sm font-medium text-background transition hover:bg-muted-foreground/90 disabled:opacity-50'
              data-track-category='knowledge-base'
              data-track-name='name-dialog-submit'
              data-ph-capture-attribute-track-id='kb_name_dialog_submit'
            >
              {submitting ? (submittingLabel ?? 'Creating...') : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
