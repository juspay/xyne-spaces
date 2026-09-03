import { ReactElement, useState } from 'react';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { cn } from '@/utils/classNames';
import { usePatchDigitalTwinCandidate } from '@/hooks/useClawDigitalTwin';
import type { DigitalTwinCandidate } from '@/services/claw/digitalTwinTypes';
import { scoreToneClass } from './format';

const iconBtn =
  'flex size-[30px] items-center justify-center rounded-full transition active:scale-95 disabled:opacity-50';

export const CandidateRow = ({
  candidate,
  onApproved,
  onRejected,
}: {
  candidate: DigitalTwinCandidate;
  onApproved: (id: string) => void;
  onRejected: (id: string) => void;
}): ReactElement => {
  const patch = usePatchDigitalTwinCandidate();
  const [acting, setActing] = useState<'approve' | 'reject' | 'save' | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(candidate.editedText ?? candidate.text);
  const [committed, setCommitted] = useState(candidate.editedText ?? candidate.text);

  const isBusy = acting !== null;
  const isDirty = text.trim() !== committed.trim();

  const handleApprove = async (): Promise<void> => {
    setActing('approve');
    try {
      await patch.mutateAsync({
        id: candidate.id,
        patch: { ...(isDirty ? { editedText: text.trim() } : {}), status: 'approved' },
      });
      toast.success('Approved — memory saved to Hindsight');
      onApproved(candidate.id);
    } finally {
      setActing(null);
    }
  };

  const handleReject = async (): Promise<void> => {
    setActing('reject');
    try {
      await patch.mutateAsync({ id: candidate.id, patch: { status: 'rejected' } });
      toast.success('Rejected');
      onRejected(candidate.id);
    } finally {
      setActing(null);
    }
  };

  const handleSave = async (): Promise<void> => {
    if (!isDirty) {
      setEditing(false);
      return;
    }
    setActing('save');
    try {
      await patch.mutateAsync({ id: candidate.id, patch: { editedText: text.trim() } });
      setCommitted(text.trim());
      setEditing(false);
      toast.success('Edit saved');
    } finally {
      setActing(null);
    }
  };

  return (
    <div className='flex w-full items-start gap-2.5 px-3.5 py-3'>
      <div className='min-w-0 flex-1'>
        {editing ? (
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            data-track-category='Claw Agents'
            data-track-name='Digital Twin edit candidate text'
            disabled={isBusy}
            rows={3}
            autoFocus
            className='w-full resize-none rounded-lg border border-primary bg-background px-2.5 py-1.5 text-xs leading-relaxed text-foreground focus:outline-none disabled:opacity-60'
          />
        ) : (
          <p className='line-clamp-2 text-xs leading-relaxed text-foreground'>{committed}</p>
        )}
        <div className='mt-1.5 flex flex-wrap items-center gap-2'>
          <span className={cn('text-[10px] font-medium', scoreToneClass(candidate.signalScore))}>
            {Math.round(candidate.signalScore * 100)}% confidence
          </span>
          {isDirty && !editing && (
            <span className='text-[10px] font-medium text-amber-600 dark:text-amber-400'>
              · edited
            </span>
          )}
          {(candidate.sourceRefs?.length ?? 0) > 0 && (
            <span className='text-[10px] text-muted-foreground'>
              {candidate.sourceRefs.length} source{candidate.sourceRefs.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      <div className='flex shrink-0 items-center gap-2'>
        {editing ? (
          <>
            <Tooltip side='top' content='Save edit'>
              <button
                type='button'
                onClick={() => void handleSave()}
                data-track-category='Claw Agents'
                data-track-name='Digital Twin save candidate edit'
                disabled={isBusy}
                className={cn(iconBtn, 'bg-primary text-primary-foreground hover:opacity-85')}
              >
                {acting === 'save' ? (
                  <Loader2 className='size-3.5 animate-spin' />
                ) : (
                  <Check className='size-3.5' />
                )}
              </button>
            </Tooltip>
            <Tooltip side='top' content='Cancel'>
              <button
                type='button'
                onClick={() => {
                  setText(committed);
                  setEditing(false);
                }}
                data-track-category='Claw Agents'
                data-track-name='Digital Twin cancel candidate edit'
                disabled={isBusy}
                className={cn(
                  iconBtn,
                  'border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <X className='size-3.5' />
              </button>
            </Tooltip>
          </>
        ) : (
          <>
            <Tooltip side='top' content='Edit'>
              <button
                type='button'
                onClick={() => setEditing(true)}
                data-track-category='Claw Agents'
                data-track-name='Digital Twin edit candidate'
                disabled={isBusy}
                className={cn(
                  iconBtn,
                  'border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Pencil className='size-3.5' />
              </button>
            </Tooltip>
            <Tooltip side='top' content={isDirty ? 'Save & approve' : 'Approve'}>
              <button
                type='button'
                onClick={() => void handleApprove()}
                data-track-category='Claw Agents'
                data-track-name='Digital Twin approve candidate'
                disabled={isBusy}
                className={cn(iconBtn, 'bg-emerald-600 text-white hover:opacity-85')}
              >
                {acting === 'approve' ? (
                  <Loader2 className='size-3.5 animate-spin' />
                ) : (
                  <Check className='size-3.5' />
                )}
              </button>
            </Tooltip>
            <Tooltip side='top' content='Reject'>
              <button
                type='button'
                onClick={() => void handleReject()}
                data-track-category='Claw Agents'
                data-track-name='Digital Twin reject candidate'
                disabled={isBusy}
                className={cn(
                  iconBtn,
                  'border border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20',
                )}
              >
                {acting === 'reject' ? (
                  <Loader2 className='size-3.5 animate-spin' />
                ) : (
                  <X className='size-3.5' />
                )}
              </button>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
};
