import { ReactElement, useEffect, useMemo, useState } from 'react';
import { TicketReferenceRelation } from '@xyne/shared';
import Dialog from '../ui/Dialog';
import { Button } from '../ui/Button/Button';
import { Switch } from '../ui/Switch';
import { cn } from '../../utils/classNames';
import { getApiErrorMessage } from '../../utils/apiError';
import { apiInstance } from '../../services/clients/apiClient';

type ThreadCanvasScope = 'both' | 'chat' | 'email';

interface AddThreadToCanvasTicket {
  id: string;
  // Shaped for a Zero row: readonly array, and exactOptionalPropertyTypes needs
  // the explicit `undefined` on relationships Zero may not have hydrated.
  referencesIn?: ReadonlyArray<{
    relationType?: string | null | undefined;
    sourceTicket?: { conversationId?: string | null | undefined } | null | undefined;
  }> | null;
}

interface AddThreadToCanvasDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: AddThreadToCanvasTicket;
  onSuccess: (canvasId: string) => void;
}

const SCOPE_OPTIONS: Array<{ value: ThreadCanvasScope; label: string }> = [
  { value: 'both', label: 'Chat + Email' },
  { value: 'chat', label: 'Chat thread' },
  { value: 'email', label: 'Email thread' },
];

export const AddThreadToCanvasDialog = ({
  open,
  onOpenChange,
  ticket,
  onSuccess,
}: AddThreadToCanvasDialogProps): ReactElement => {
  const [scope, setScope] = useState<ThreadCanvasScope>('both');
  const [includeMerged, setIncludeMerged] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mergedCount = useMemo(
    () =>
      (ticket.referencesIn ?? []).filter(
        ref =>
          ref.relationType === TicketReferenceRelation.MERGED_INTO &&
          !!ref.sourceTicket?.conversationId,
      ).length,
    [ticket.referencesIn],
  );

  // Reset per-open state each time the dialog is surfaced for a ticket.
  useEffect(() => {
    if (!open) return;
    setScope('both');
    setIncludeMerged(true);
    setError(null);
  }, [open]);

  const handleSubmit = async (): Promise<void> => {
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await apiInstance.post<{ canvasId: string }>(
        `/tickets/${ticket.id}/canvas`,
        { scope, includeMerged },
      );
      onOpenChange(false);
      onSuccess(response.data.canvasId);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to create canvas'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='Add thread to canvas'
      className='max-w-[460px]'
    >
      <div className='p-6 flex flex-col gap-5'>
        <p className='text-sm text-muted-foreground'>
          Generate a canvas from this ticket&apos;s thread in the desk channel. The canvas opens
          right away and fills in as the agent finishes.
        </p>

        <div className='flex flex-col gap-2'>
          <span className='text-xs font-semibold text-muted-foreground uppercase tracking-wide'>
            What to include
          </span>
          <div className='flex items-center border border-border rounded-lg overflow-hidden w-fit'>
            {SCOPE_OPTIONS.map(option => (
              <button
                key={option.value}
                type='button'
                onClick={() => setScope(option.value)}
                className={cn(
                  'px-3 py-1.5 text-sm transition-colors',
                  scope === option.value
                    ? 'bg-muted text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                )}
                data-track-category='Support'
                data-track-name='AddThreadToCanvasScope'
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {mergedCount > 0 && (
          <Switch
            checked={includeMerged}
            onCheckedChange={setIncludeMerged}
            label={`Include merged tickets (${mergedCount})`}
            aria-label='Include merged tickets'
          />
        )}

        {error && <p className='text-sm text-destructive'>{error}</p>}

        <div className='flex justify-end gap-3'>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            data-track-category='Support'
            data-track-name='AddThreadToCanvasCancel'
          >
            Cancel
          </Button>
          <Button
            variant='default'
            className='bg-primary hover:bg-primary/90 text-white'
            onClick={() => void handleSubmit()}
            disabled={isSubmitting}
            loading={isSubmitting}
            data-track-category='Support'
            data-track-name='AddThreadToCanvasGenerate'
          >
            Generate canvas
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
