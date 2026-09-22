import { ReactElement, useCallback, useEffect, useMemo, useState } from 'react';
import { TicketReferenceRelation } from '@xyne/shared';
import { PlusDefault as Plus, MultipleCrossCancelDefault as X } from '@xyne/icons';
import Dialog from '../ui/Dialog';
import { Button } from '../ui/Button/Button';
import { Switch } from '../ui/Switch';
import { cn } from '../../utils/classNames';
import { getApiErrorMessage } from '../../utils/apiError';
import { apiInstance } from '../../services/clients/apiClient';
import { canvasLabelsApi } from '../../api/canvasLabelsApi';

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

const MAX_LABELS = 10;
const MAX_LABEL_LENGTH = 64;

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
  const [labelInput, setLabelInput] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
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
    setLabelInput('');
    setLabels([]);
    setIncludeMerged(true);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      canvasLabelsApi
        .getCanvasLabelSuggestions(labelInput.trim() || undefined)
        .then(result => {
          if (!cancelled) setSuggestions(result);
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, labelInput]);

  const addLabel = useCallback((name: string): void => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Caps mirror the server's zod schema; over them is a 400.
    setLabels(prev =>
      prev.includes(trimmed) || prev.length >= MAX_LABELS ? prev : [...prev, trimmed],
    );
    setLabelInput('');
  }, []);

  const removeLabel = useCallback((name: string): void => {
    setLabels(prev => prev.filter(l => l !== name));
  }, []);

  const filteredSuggestions = useMemo(
    () => suggestions.filter(s => !labels.includes(s)).slice(0, 8),
    [suggestions, labels],
  );

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await apiInstance.post<{ canvasId: string }>(
        `/tickets/${ticket.id}/canvas`,
        { scope, labels, includeMerged },
      );
      onOpenChange(false);
      onSuccess(response.data.canvasId);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to create canvas'));
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, ticket.id, scope, labels, includeMerged, onOpenChange, onSuccess]);

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
                data-track-metadata={JSON.stringify({ scope: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className='flex flex-col gap-2'>
          <span className='text-xs font-semibold text-muted-foreground uppercase tracking-wide'>
            Labels
          </span>
          {labels.length > 0 && (
            <div className='flex items-center gap-1.5 flex-wrap'>
              {labels.map(label => (
                <span
                  key={label}
                  className='flex items-center gap-1 bg-muted/60 border border-border rounded-full pl-3 pr-1 py-0.5 max-w-[220px]'
                >
                  <span className='text-xs text-foreground truncate'>{label}</span>
                  <button
                    type='button'
                    onClick={() => removeLabel(label)}
                    className='p-0.5 rounded-full text-muted-foreground hover:text-destructive transition-colors shrink-0'
                    aria-label={`Remove label ${label}`}
                    data-track-category='Support'
                    data-track-name='AddThreadToCanvasRemoveLabel'
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            type='text'
            value={labelInput}
            onChange={e => setLabelInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addLabel(labelInput);
              }
            }}
            maxLength={MAX_LABEL_LENGTH}
            disabled={labels.length >= MAX_LABELS}
            placeholder='Type a label and press Enter'
            className='w-full rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary'
            data-track-category='Support'
            data-track-name='AddThreadToCanvasLabelInput'
          />
          {filteredSuggestions.length > 0 && (
            <div className='flex items-center gap-1.5 flex-wrap'>
              {filteredSuggestions.map(suggestion => (
                <button
                  key={suggestion}
                  type='button'
                  onClick={() => addLabel(suggestion)}
                  className='flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
                  data-track-category='Support'
                  data-track-name='AddThreadToCanvasSuggestion'
                >
                  <Plus size={12} />
                  <span className='truncate max-w-[180px]'>{suggestion}</span>
                </button>
              ))}
            </div>
          )}
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
            data-track-metadata={JSON.stringify({
              scope,
              labelCount: labels.length,
              includeMerged: mergedCount > 0 ? includeMerged : undefined,
            })}
          >
            Generate canvas
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export default AddThreadToCanvasDialog;
