import { ReactElement, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

const HANDLE_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

const validateHandle = (handle: string): string | null => {
  if (!handle) return 'Handle is required.';
  if (handle.length < 2) return 'Handle must be at least 2 characters.';
  if (handle.length > 64) return 'Handle must be 64 characters or fewer.';
  if (!HANDLE_REGEX.test(handle)) {
    return 'Use lowercase letters, digits, and hyphens, with no leading or trailing hyphen.';
  }
  return null;
};

export const RenameHandleDialog = ({
  open,
  onOpenChange,
  currentHandle,
  onRename,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentHandle: string;
  onRename: (handle: string) => Promise<void>;
}): ReactElement => {
  const [draft, setDraft] = useState(currentHandle);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(currentHandle);
      setSubmitting(false);
      setError(null);
    }
  }, [open, currentHandle]);

  const normalized = draft.trim().toLowerCase();
  const validationError = normalized === currentHandle ? null : validateHandle(normalized);
  const canSubmit = normalized !== currentHandle && !validationError && !submitting;

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onRename(normalized);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not rename this handle.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title='Rename handle'>
      <form
        className='flex flex-col gap-4 p-6'
        onSubmit={event => {
          event.preventDefault();
          void submit();
        }}
      >
        <div>
          <h2 className='text-base font-semibold text-foreground'>Rename handle</h2>
          <p className='mt-1 text-sm text-muted-foreground'>
            This changes the agent URL and breaks existing deep links.
          </p>
        </div>
        <div className='flex flex-col gap-1.5'>
          <label htmlFor='agent-handle' className='text-sm font-medium text-foreground'>
            New handle
          </label>
          <Input
            id='agent-handle'
            autoFocus
            value={draft}
            onChange={event => setDraft(event.target.value)}
            disabled={submitting}
            className='font-mono'
          />
          <p className='text-xs text-muted-foreground'>
            2–64 lowercase letters, digits, or hyphens.
          </p>
        </div>
        {normalized !== currentHandle && !validationError && (
          <p className='rounded-md bg-muted/40 p-3 font-mono text-xs text-muted-foreground'>
            /agents/{currentHandle} → /agents/{normalized}
          </p>
        )}
        {(validationError || error) && (
          <div className='flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive'>
            <AlertTriangle className='mt-0.5 size-4 shrink-0' />
            {validationError || error}
          </div>
        )}
        <div className='flex justify-end gap-2'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => onOpenChange(false)}
            data-track-category='Claw Agents'
            data-track-name='CANCEL_RENAME_HANDLE'
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type='submit' size='sm' loading={submitting} disabled={!canSubmit}>
            Rename
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
