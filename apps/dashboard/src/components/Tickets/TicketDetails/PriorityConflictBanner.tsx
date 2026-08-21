import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { PriorityConflictState, TicketPriority } from '@xyne/shared';
import { useZero } from '../../../hooks/useZero';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useChannel } from '../../../hooks/useChannels';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { Button } from '../../ui/Button';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import Textarea from '../../ui/Textarea';

interface PriorityConflictBannerProps {
  ticketId: string;
  /** Viewer, used to decide whether they can accept (respondent) or withdraw (raiser). */
  currentUserId: string | undefined;
  /** Current priority — escalating to HIGH/CRITICAL after creation opens the same queue flow. */
  priority: string | undefined;
  /** Raiser of this ticket; only they can claim a place ahead of someone else's task. */
  createdBy: string | undefined;
  /** Channel the ticket lives in, used to scope both the opt-in check and the task list. */
  channelId: string | undefined;
}

/**
 * Shows the state of a ticket's priority negotiation and the one action its viewer can take.
 *
 * The ticket is blocked while its newest claim is PENDING and unblocked once any claim is
 * ACCEPTED. There is no reject button by design: the superseded owner is never asked to say no,
 * so leaving a claim unanswered is what keeps the ticket blocked. Only the raiser can move it
 * along — by withdrawing and picking a different task to go ahead of.
 *
 * Renders nothing for tickets that never went through the flow.
 */
export function PriorityConflictBanner({
  ticketId,
  currentUserId,
  priority,
  createdBy,
  channelId,
}: PriorityConflictBannerProps): React.ReactElement | null {
  const zero = useZero();
  const [claims] = useCachedQuery(queries.getPriorityConflictClaims({ ticketId }), {
    enabled: !!ticketId,
  });
  const [responseNote, setResponseNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pickedTicketId, setPickedTicketId] = useState('');
  const [claimReason, setClaimReason] = useState('');

  // Escalating to HIGH/CRITICAL after creation lands here rather than in the create modal, so
  // the raiser still gets a way to jump ahead of a task instead of silently joining the back
  // of the queue.
  //
  // useChannel is a state-machine selector over already-loaded channels, not a query — passing
  // '' for a channel-less ticket just matches nothing. No request is issued and no cache entry
  // is created.
  const channel = useChannel(channelId ?? '');
  const conflictEnabled = channel?.priorityConflictEnabled === true;
  const isHighPriority =
    priority === TicketPriority.HIGH || priority === TicketPriority.CRITICAL;

  const [channelTickets] = useCachedQuery(
    queries.getSupersedableTicketsByChannel({ channelId: channelId || 'nonexistent' }),
    { enabled: conflictEnabled && isHighPriority && !!channelId },
  );
  const supersedeOptions = useMemo(
    () =>
      (channelTickets ?? []).filter(
        t => t.id !== ticketId && (t.assignedTo ?? t.createdBy) !== currentUserId,
      ),
    [channelTickets, ticketId, currentUserId],
  );

  // Claims come back newest-first. An accepted claim anywhere in the history means the ticket
  // was unblocked and stays that way.
  const acceptedClaim = useMemo(
    () => (claims ?? []).find(c => c.state === PriorityConflictState.ACCEPTED),
    [claims],
  );
  const pendingClaim = useMemo(
    () => (claims ?? []).find(c => c.state === PriorityConflictState.PENDING),
    [claims],
  );

  /** Raise a fresh claim from the ticket detail — the post-escalation entry point. */
  const handleClaim = async (): Promise<void> => {
    if (!pickedTicketId || !claimReason.trim()) return;
    setIsSubmitting(true);
    try {
      const result = await zero.mutate(
        mutators.priorityConflict.claim({
          id: uuidv4(),
          ticketId,
          supersededTicketId: pickedTicketId,
          justification: claimReason.trim(),
          timestamp: Date.now(),
        }),
      ).server;
      if (result.type === 'error') {
        toast.error(result.error.message || 'Failed to raise the priority claim');
        return;
      }
      setPickedTicketId('');
      setClaimReason('');
      toast.success('Sent — waiting for that task’s owner to agree');
    } catch {
      toast.error('Failed to raise the priority claim');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAccept = async (): Promise<void> => {
    if (!pendingClaim) return;
    setIsSubmitting(true);
    try {
      const result = await zero.mutate(
        mutators.priorityConflict.accept({
          id: pendingClaim.id,
          timestamp: Date.now(),
          ...(responseNote.trim() ? { responseNote: responseNote.trim() } : {}),
        }),
      ).server;
      if (result.type === 'error') {
        toast.error(result.error.message || 'Failed to accept the priority claim');
        return;
      }
      setResponseNote('');
      toast.success('Priority claim accepted');
    } catch {
      toast.error('Failed to accept the priority claim');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWithdraw = async (): Promise<void> => {
    if (!pendingClaim) return;
    setIsSubmitting(true);
    try {
      const result = await zero.mutate(
        mutators.priorityConflict.withdraw({
          id: pendingClaim.id,
          timestamp: Date.now(),
        }),
      ).server;
      if (result.type === 'error') {
        toast.error(result.error.message || 'Failed to withdraw the priority claim');
        return;
      }
      toast.success('Priority claim withdrawn');
    } catch {
      toast.error('Failed to withdraw the priority claim');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isRaiserOfTicket = !!currentUserId && currentUserId === createdBy;
  const hasLiveClaim = !!acceptedClaim || !!pendingClaim;

  // A high-priority ticket in an opted-in channel with no live claim is sitting at the back of
  // the queue. That happens either because the raiser skipped the picker at creation, or —
  // the case this covers — because they escalated the priority afterwards, which never went
  // through the create modal at all.
  const canClaimAhead = conflictEnabled && isHighPriority && !hasLiveClaim && isRaiserOfTicket;

  if (canClaimAhead) {
    return (
      <div className='rounded-md border border-border bg-muted p-3'>
        <p className='text-sm font-semibold text-foreground'>Jump ahead of a task</p>
        <p className='mt-1 text-sm text-muted-foreground'>
          This task is at the back of the priority queue. Pick a task to go ahead of it — its
          owner has to agree before work can start.
        </p>
        {supersedeOptions.length === 0 ? (
          <p className='mt-2 text-sm text-muted-foreground'>
            No one else has open tasks here, so this one stays at the back of the queue.
          </p>
        ) : (
          <div className='mt-2 space-y-2'>
            <EntitySelector
              options={supersedeOptions.map(t => ({
                value: t.id,
                label: t.title || t.xyneId,
                icon: null,
              }))}
              selectedValue={pickedTicketId || null}
              onSelect={(value: string | null) => setPickedTicketId(value ?? '')}
              searchPlaceholder='Search tasks'
              placeholder='Go ahead of…'
              width='100%'
              inputClassName='bg-background justify-between py-1.5'
              showClearButton={true}
              showIndicator={false}
              testId='priority-conflict-claim-selector'
            />
            {!!pickedTicketId && (
              <>
                <Textarea
                  rows={2}
                  value={claimReason}
                  placeholder='Why should it go first? Shown to the other task’s owner...'
                  aria-label='Why should it go first'
                  onChange={e => setClaimReason(e.target.value)}
                  className='resize-none bg-background text-sm'
                />
                <Button
                  type='button'
                  disabled={isSubmitting || !claimReason.trim()}
                  onClick={() => void handleClaim()}
                  data-testid='priority-conflict-claim'
                >
                  Ask to go first
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  if (!claims || claims.length === 0) {
    return null;
  }

  if (acceptedClaim) {
    const supersededLabel =
      acceptedClaim.supersededTicket?.title || acceptedClaim.supersededTicket?.xyneId || 'a task';
    return (
      <div className='rounded-md border border-border bg-muted p-3'>
        <p className='text-sm font-semibold text-foreground'>Priority conflict resolved</p>
        <p className='mt-1 text-sm text-muted-foreground'>
          Accepted as higher priority than &ldquo;{supersededLabel}&rdquo;.
          {acceptedClaim.responseNote ? ` — “${acceptedClaim.responseNote}”` : ''}
        </p>
      </div>
    );
  }

  if (!pendingClaim) {
    // Every claim was withdrawn and none accepted — the raiser still has to pick a task.
    return (
      <div className='rounded-md border border-border bg-muted p-3'>
        <p className='text-sm font-semibold text-foreground'>Priority claim withdrawn</p>
        <p className='mt-1 text-sm text-muted-foreground'>
          This ticket has no task it goes ahead of. Pick one to get it accepted, or lower its
          priority.
        </p>
      </div>
    );
  }

  const supersededLabel =
    pendingClaim.supersededTicket?.title || pendingClaim.supersededTicket?.xyneId || 'a task';
  const isRespondent = currentUserId === pendingClaim.respondentId;
  const isRaiser = currentUserId === pendingClaim.raisedBy;

  return (
    <div className='rounded-md border border-border bg-muted p-3'>
      <p className='text-sm font-semibold text-foreground'>Blocked: priority conflict</p>
      <p className='mt-1 text-sm text-muted-foreground'>
        This task is claimed to take priority over &ldquo;{supersededLabel}&rdquo;. It stays
        blocked until that task&apos;s owner accepts.
      </p>
      <p className='mt-2 text-sm text-foreground/80'>“{pendingClaim.justification}”</p>

      {isRespondent && (
        <div className='mt-3 space-y-2'>
          <Textarea
            rows={2}
            value={responseNote}
            placeholder='Add a note (optional)...'
            aria-label='Response note'
            onChange={e => setResponseNote(e.target.value)}
            className='resize-none bg-background text-sm'
          />
          <Button
            type='button'
            disabled={isSubmitting}
            onClick={() => void handleAccept()}
            data-testid='priority-conflict-accept'
          >
            Accept as higher priority
          </Button>
          <p className='text-sm text-muted-foreground'>
            If you don&apos;t agree, leave this as is — the ticket stays blocked until you accept.
          </p>
        </div>
      )}

      {isRaiser && (
        <div className='mt-3'>
          <Button
            type='button'
            variant='outline'
            disabled={isSubmitting}
            onClick={() => void handleWithdraw()}
            data-testid='priority-conflict-withdraw'
          >
            Withdraw and pick another task
          </Button>
        </div>
      )}
    </div>
  );
}
