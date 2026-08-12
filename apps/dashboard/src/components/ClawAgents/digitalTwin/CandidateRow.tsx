import { ReactElement, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, ChevronDown, Loader2, Pencil, Save, X } from './icons';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { usePatchDigitalTwinCandidate } from '@/hooks/useClawDigitalTwin';
import type { DigitalTwinCandidate } from '@/services/claw/digitalTwinTypes';

const proposalTitle = (value: string): string => {
  const firstClause = value.split(/[.!?:;]/, 1)[0]?.trim() ?? '';
  const words = firstClause.split(/\s+/).filter(Boolean);
  if (words.length <= 7) return firstClause || 'Untitled proposal';
  return `${words.slice(0, 7).join(' ')}…`;
};

const MOTION_EASE = [0.22, 1, 0.36, 1] as const;

export const CandidateRow = ({
  candidate,
  total,
  onApproved,
  onRejected,
  onRestore,
  onOutcome,
}: {
  candidate: DigitalTwinCandidate;
  total: number;
  onApproved: (id: string) => void;
  onRejected: (id: string) => void;
  onRestore: (id: string) => void;
  onOutcome: (message: string, error?: boolean) => void;
}): ReactElement => {
  const patch = usePatchDigitalTwinCandidate();
  const reduceMotion = useReducedMotion();
  const [acting, setActing] = useState<'approve' | 'reject' | 'save' | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(candidate.editedText ?? candidate.text);
  const [committed, setCommitted] = useState(candidate.editedText ?? candidate.text);

  const busy = acting !== null;
  const dirty = text.trim() !== committed.trim();
  const confidence = Math.round(Math.max(0, Math.min(1, candidate.signalScore)) * 100);
  const title = candidate.title?.trim() || proposalTitle(committed);
  const detailsId = `candidate-details-${candidate.id}`;

  const toggleExpanded = (): void => {
    if (expanded && editing) {
      setText(committed);
      setEditing(false);
    }
    setExpanded(previous => !previous);
  };

  const approve = async (): Promise<void> => {
    setActing('approve');
    onApproved(candidate.id);
    try {
      await patch.mutateAsync({
        id: candidate.id,
        patch: { ...(dirty ? { editedText: text.trim() } : {}), status: 'approved' },
      });
      onOutcome(`Added to memory. ${Math.max(0, total - 1)} left to review.`);
      toast.success('Approved and added to memory');
    } catch {
      onRestore(candidate.id);
      onOutcome('This proposal could not be approved. It is back in your queue—try again.', true);
    } finally {
      setActing(null);
    }
  };

  const reject = async (): Promise<void> => {
    setActing('reject');
    onRejected(candidate.id);
    try {
      await patch.mutateAsync({ id: candidate.id, patch: { status: 'rejected' } });
      onOutcome(`Removed from review. ${Math.max(0, total - 1)} left.`);
      toast.success('Proposal rejected');
    } catch {
      onRestore(candidate.id);
      onOutcome('This proposal could not be rejected. It is back in your queue—try again.', true);
    } finally {
      setActing(null);
    }
  };

  const save = async (): Promise<void> => {
    if (!dirty) {
      setEditing(false);
      return;
    }
    setActing('save');
    try {
      await patch.mutateAsync({ id: candidate.id, patch: { editedText: text.trim() } });
      setCommitted(text.trim());
      setEditing(false);
      onOutcome('Edit saved. Review the final wording, then approve or reject it.');
      toast.success('Edit saved');
    } catch {
      onOutcome('Your edit could not be saved. It is still here so you can try again.', true);
    } finally {
      setActing(null);
    }
  };

  return (
    <article className='dt-review-proposal' aria-labelledby={`candidate-${candidate.id}`}>
      <button
        type='button'
        className='dt-review-proposal-toggle'
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={toggleExpanded}
        data-track-category='Claw Agents'
        data-track-name='Digital Twin toggle proposal'
      >
        <span className='dt-review-proposal-heading'>
          <span id={`candidate-${candidate.id}`} className='dt-review-proposal-title'>
            {title}
          </span>
          <span className='dt-review-confidence'>{confidence}% Confidence</span>
        </span>
        <motion.span
          className='inline-flex shrink-0 text-muted-foreground'
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.18, ease: MOTION_EASE }}
          aria-hidden='true'
        >
          <ChevronDown className='size-4' />
        </motion.span>
      </button>

      <div id={detailsId} className='dt-review-proposal-content'>
        {editing ? (
          <label className='block'>
            <span className='sr-only'>Edit proposed memory</span>
            <textarea
              value={text}
              onChange={event => setText(event.target.value)}
              disabled={busy}
              rows={5}
              autoFocus
              className='w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm leading-6 text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/10 disabled:opacity-60'
              data-track-category='Claw Agents'
              data-track-name='Digital Twin edit candidate text'
            />
          </label>
        ) : (
          <p
            className={`dt-review-proposal-copy${expanded ? '' : ' dt-review-proposal-copy-clamped'}`}
          >
            {committed}
          </p>
        )}

        <div
          className='dt-review-proposal-actions-reveal'
          data-expanded={expanded}
          aria-hidden={!expanded}
        >
          <div className='dt-review-proposal-actions-reveal-inner'>
            <motion.footer
              className='dt-review-proposal-actions'
              animate={
                reduceMotion
                  ? { opacity: 1, y: 0 }
                  : { opacity: expanded ? 1 : 0, y: expanded ? 0 : -4 }
              }
              transition={{ duration: reduceMotion ? 0 : 0.18, ease: MOTION_EASE }}
            >
              {editing ? (
                <>
                  <Button
                    variant='outline'
                    size='sm'
                    className='h-7 rounded-[10px] px-2 shadow-none'
                    disabled={busy || !expanded}
                    onClick={() => {
                      setText(committed);
                      setEditing(false);
                    }}
                    data-track-category='Claw Agents'
                    data-track-name='Digital Twin cancel candidate edit'
                  >
                    <X className='size-4' />
                    Cancel
                  </Button>
                  <Button
                    size='sm'
                    className='h-7 rounded-[10px] px-2 shadow-none'
                    disabled={!expanded || !text.trim() || busy}
                    onClick={() => void save()}
                    data-track-category='Claw Agents'
                    data-track-name='Digital Twin save candidate edit'
                  >
                    {acting === 'save' ? (
                      <Loader2 className='size-4 animate-spin' />
                    ) : (
                      <Save className='size-4' />
                    )}
                    Save edit
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant='outline'
                    size='iconSm'
                    className='size-7 rounded-[10px] p-0 shadow-none'
                    aria-label={`Edit ${title}`}
                    title='Edit proposal'
                    disabled={busy || !expanded}
                    onClick={() => setEditing(true)}
                    data-track-category='Claw Agents'
                    data-track-name='Digital Twin edit candidate'
                  >
                    <Pencil className='size-4' />
                  </Button>
                  <Button
                    variant='outline'
                    size='iconSm'
                    className='size-7 rounded-[10px] p-0 shadow-none'
                    aria-label={`Reject ${title}`}
                    title='Reject proposal'
                    disabled={busy || !expanded}
                    onClick={() => void reject()}
                    data-track-category='Claw Agents'
                    data-track-name='Digital Twin reject candidate'
                  >
                    {acting === 'reject' ? (
                      <Loader2 className='size-4 animate-spin' />
                    ) : (
                      <X className='size-4' />
                    )}
                  </Button>
                  <Button
                    size='iconSm'
                    className='size-7 rounded-[10px] p-0 shadow-none'
                    aria-label={`Approve ${title}`}
                    title='Approve proposal'
                    disabled={busy || !expanded}
                    onClick={() => void approve()}
                    data-track-category='Claw Agents'
                    data-track-name='Digital Twin approve candidate'
                  >
                    {acting === 'approve' ? (
                      <Loader2 className='size-4 animate-spin' />
                    ) : (
                      <Check className='size-4' />
                    )}
                  </Button>
                </>
              )}
            </motion.footer>
          </div>
        </div>
      </div>
    </article>
  );
};
