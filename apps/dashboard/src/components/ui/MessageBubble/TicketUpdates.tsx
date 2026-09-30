import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { isTicketUpdateClaimFresh } from '@xyne/shared';
import { logger, Event as LogEvent } from '../../../utils/logger';
import {
  callService,
  TicketUpdateApplyError,
  type AppliedTicketUpdateResult,
} from '../../../services/Call/callService';
import { globalClickTracker } from '../../../services/Analytics/globalClickTracker';
import { useAuth } from '../../../hooks/useAuth';
import { useQuery } from '../../../hooks/useQuery';
import { queries } from '../../../zero/queries';
import {
  formatTranscriptTimestamp,
  type AppliedTicketUpdate,
  type IgnoredTicketUpdate,
  type TicketUpdateProposal,
} from '../../../utils/markdownTicketUpdates';

interface TicketUpdatesProps {
  callId: string;
  channelId: string;
  messageId: string;
  updates: TicketUpdateProposal[];
  applied: AppliedTicketUpdate[];
  ignored: IgnoredTicketUpdate[];
}

interface RowDraft {
  text: string;
  postComment: boolean;
  changeStatus: boolean;
  stageName: string;
}

/** What a row shows about its ticket, and whether this viewer may see it at all. */
interface RowTicket {
  state: 'ready' | 'loading' | 'locked';
  xyneId: string;
  title: string;
  channelId: string;
  conversationId: string;
  stageName: string;
}

/** The identity a card entry may or may not carry (restricted rows carry none). */
interface TicketRef {
  restricted: boolean;
  ticketId: string;
  xyneId: string;
  title: string;
  ticketChannelId?: string;
  ticketConversationId?: string;
  currentStageName?: string;
}

const NO_ACCESS = "You don't have access to this ticket";

const draftFor = (u: TicketUpdateProposal): RowDraft => ({
  text: u.update,
  postComment: true,
  changeStatus: u.proposedStatusV2 !== null && u.boardType !== 'FLOW',
  stageName: u.proposedStageName ?? '',
});

/**
 * Review card for updates to EXISTING tickets that were said during a call.
 * Each row can be approved (posts the note on the ticket thread and/or moves the
 * ticket's stage, both as the signed-in user) or ignored. State lives in the
 * message content, so every participant sees the same card.
 *
 * A ticket from outside the call's channel arrives without its identity: the row
 * is filled in from the viewer's own synced tickets, and stays locked for a
 * viewer who cannot read that ticket.
 */
export const TicketUpdates: React.FC<TicketUpdatesProps> = ({
  callId,
  channelId,
  messageId,
  updates,
  applied,
  ignored,
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showIgnored, setShowIgnored] = useState(false);
  // Stages the server offered after refusing a move it could not resolve itself.
  const [offeredStages, setOfferedStages] = useState<Record<string, string[]>>({});

  const restrictedIds = useMemo(
    () =>
      Array.from(
        new Set(
          [...updates, ...applied, ...ignored].filter(e => e.restricted).map(e => e.ticketId),
        ),
      ),
    [updates, applied, ignored],
  );
  const [restrictedTickets, restrictedDetails] = useQuery(
    queries.ticketsByIds({ ticketIds: restrictedIds }),
    { enabled: restrictedIds.length > 0 },
  );
  const restrictedLoaded = restrictedIds.length === 0 || restrictedDetails.type === 'complete';
  const restrictedById = useMemo(
    () => new Map((restrictedTickets ?? []).map(t => [t.id, t])),
    [restrictedTickets],
  );

  const ticketFor = (entry: TicketRef): RowTicket => {
    if (!entry.restricted) {
      return {
        state: 'ready',
        xyneId: entry.xyneId,
        title: entry.title,
        // Cards posted before the ticket's channel was recorded fall back to the call's.
        channelId: entry.ticketChannelId || channelId,
        conversationId: entry.ticketConversationId ?? '',
        stageName: entry.currentStageName ?? '',
      };
    }
    const ticket = restrictedById.get(entry.ticketId);
    if (!ticket) {
      return {
        state: restrictedLoaded ? 'locked' : 'loading',
        xyneId: '',
        title: '',
        channelId: '',
        conversationId: '',
        stageName: '',
      };
    }
    return {
      state: 'ready',
      xyneId: ticket.xyneId ?? '',
      title: ticket.title ?? '',
      channelId: ticket.channelId ?? '',
      conversationId: ticket.conversationId ?? '',
      stageName: ticket.stageName ?? '',
    };
  };

  const claimedByOther = (u: TicketUpdateProposal): boolean =>
    isTicketUpdateClaimFresh(u.claim) && u.claim.by !== user?.id;
  const actionable = updates.filter(u => ticketFor(u).state === 'ready' && !claimedByOther(u));
  const lockedCount = updates.filter(u => ticketFor(u).state === 'locked').length;

  // Seed a draft per pending row; keep the user's edits across re-renders, and
  // drop selections for rows that were approved or ignored (possibly by someone else).
  useEffect(() => {
    setDrafts(prev => {
      const next: Record<string, RowDraft> = {};
      for (const u of updates) next[u.updateId] = prev[u.updateId] ?? draftFor(u);
      return next;
    });
    setSelectedIds(prev => prev.filter(id => updates.some(u => u.updateId === id)));
  }, [updates]);

  const shownForMessageRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (updates.length === 0 || shownForMessageRef.current === messageId) return;
    shownForMessageRef.current = messageId;
    globalClickTracker.trackManualEvent('MESSAGE', 'TICKET_UPDATES_SHOWN', undefined, {
      messageId,
      channelId,
      updateCount: updates.length,
      appliedCount: applied.length,
    });
  }, [updates.length, messageId, channelId, applied.length]);

  const patch = (id: string, changes: Partial<RowDraft>): void =>
    setDrafts(prev => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? { text: '', postComment: true, changeStatus: false, stageName: '' }),
        ...changes,
      },
    }));

  const openTicket = (ticketId: string, ticket: RowTicket): void => {
    void navigate(
      `/chat/dir/${ticket.channelId}/${ticket.conversationId}/${ticketId}?selectedTab=details`,
      { state: { trackSource: 'chat_message' } },
    );
  };

  const stageOptionsFor = (u: TicketUpdateProposal): string[] =>
    offeredStages[u.updateId] ?? u.stageOptions;

  /** Apply one row with its current draft. */
  const applyOne = async (
    u: TicketUpdateProposal,
  ): Promise<{ error: string } | { result: AppliedTicketUpdateResult }> => {
    const d = drafts[u.updateId] ?? draftFor(u);
    if (!d.postComment && !d.changeStatus) return { error: 'nothing selected to apply' };
    // A restricted row has no stage list on the card: the server picks the stage
    // from the status that was said, or answers with the stages to choose from.
    if (d.changeStatus && !d.stageName && !u.restricted) return { error: 'no stage chosen' };
    try {
      const result = await callService.applyTicketUpdate(callId, u.updateId, {
        postComment: d.postComment,
        changeStatus: d.changeStatus,
        message: d.text,
        ...(d.changeStatus && d.stageName ? { stageName: d.stageName } : {}),
      });
      return { result };
    } catch (error) {
      if (error instanceof TicketUpdateApplyError && error.stageOptions.length > 0) {
        const options = error.stageOptions;
        setOfferedStages(prev => ({ ...prev, [u.updateId]: options }));
      }
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'ticket_update_apply',
        message: String(error),
        error,
      });
      return { error: error instanceof Error ? error.message : 'failed to apply' };
    }
  };

  const approve = async (u: TicketUpdateProposal): Promise<void> => {
    const label = ticketFor(u).xyneId || 'Ticket';
    setBusyId(u.updateId);
    try {
      const outcome = await applyOne(u);
      if ('error' in outcome) {
        toast.error(`${label}: ${outcome.error}`);
        return;
      }
      const { commentPosted, newStageName, stagePendingApproval } = outcome.result;
      const parts = [
        commentPosted ? 'comment posted' : '',
        newStageName ? `moved to ${newStageName}` : '',
        stagePendingApproval ? `move to ${stagePendingApproval} sent for approval` : '',
      ].filter(Boolean);
      toast.success(`${label}: ${parts.join(', ') || 'applied'}`);
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Approve several rows one after another, so the toast can report them in
   * order and a slow ticket does not hold the others back visibly out of order.
   */
  const approveMany = async (rows: TicketUpdateProposal[]): Promise<void> => {
    if (rows.length === 0) return;
    setBulkBusy(true);
    const failures: string[] = [];
    let done = 0;
    try {
      for (const u of rows) {
        setBusyId(u.updateId);
        const outcome = await applyOne(u);
        if ('error' in outcome) {
          failures.push(`${ticketFor(u).xyneId || 'Ticket'}: ${outcome.error}`);
        } else {
          done += 1;
        }
      }
    } finally {
      setBusyId(null);
      setBulkBusy(false);
      setSelectedIds([]);
    }
    if (done > 0) toast.success(`Applied ${done} ticket update${done === 1 ? '' : 's'}`);
    if (failures.length > 0) toast.error(`Not applied: ${failures.join('; ')}`);
    globalClickTracker.trackManualEvent('MESSAGE', 'APPROVE_TICKET_UPDATES_BULK', undefined, {
      messageId,
      channelId,
      requested: rows.length,
      applied: done,
    });
  };

  const approveAll = (): void => {
    if (lockedCount > 0) {
      toast.info(
        `Skipping ${lockedCount} private ticket${lockedCount === 1 ? '' : 's'} you don't have access to`,
      );
    }
    void approveMany(actionable);
  };

  const toggleSelected = (id: string): void =>
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  const allSelected = actionable.length > 0 && selectedIds.length === actionable.length;
  const toggleSelectAll = (): void =>
    setSelectedIds(allSelected ? [] : actionable.map(u => u.updateId));

  const ignore = async (u: TicketUpdateProposal): Promise<void> => {
    setBusyId(u.updateId);
    try {
      await callService.ignoreTicketUpdate(callId, u.updateId);
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'ticket_update_ignore',
        message: String(error),
        error,
      });
      toast.error(error instanceof Error ? error.message : 'Failed to ignore the update');
    } finally {
      setBusyId(null);
    }
  };

  if (updates.length === 0 && applied.length === 0 && ignored.length === 0) return null;

  const privateLabel = (state: RowTicket['state']): string =>
    state === 'loading' ? 'Loading ticket…' : 'Private ticket';

  return (
    <div className='mt-3 pl-2 -ml-8 space-y-3'>
      {applied.map(a => {
        const ticket = ticketFor(a);
        const outcome = [
          a.commentMessageId ? 'commented' : '',
          a.newStageName ? `moved to ${a.newStageName}` : '',
          a.stagePendingApproval ? `move to ${a.stagePendingApproval} awaiting approval` : '',
          a.restricted && !a.commentMessageId ? 'applied' : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <div key={a.updateId} className='text-sm'>
            {ticket.state === 'ready' ? (
              <button
                onClick={() => openTicket(a.ticketId, ticket)}
                data-track-category='MESSAGE'
                data-track-name='OPEN_TICKET_FROM_UPDATE'
                className='text-left hover:underline focus:outline-none bg-transparent border-none p-0'
              >
                <span className='font-semibold text-primary'>{ticket.xyneId}</span>
                <span className='mx-1.5 text-muted-foreground'>•</span>
                <span className='text-foreground'>{ticket.title}</span>
              </button>
            ) : (
              <span className='text-muted-foreground'>{privateLabel(ticket.state)}</span>
            )}
            <span className='ml-2 text-xs text-muted-foreground'>{outcome}</span>
          </div>
        );
      })}

      {actionable.length > 1 && (
        <div className='flex flex-wrap items-center gap-x-4 gap-y-1 text-sm'>
          <label className='flex items-center gap-1.5 cursor-pointer'>
            <input
              type='checkbox'
              checked={allSelected}
              disabled={bulkBusy}
              onChange={toggleSelectAll}
              className='h-4 w-4 rounded border-border'
            />
            Select all
          </label>
          <button
            onClick={() =>
              void approveMany(actionable.filter(u => selectedIds.includes(u.updateId)))
            }
            disabled={bulkBusy || selectedIds.length === 0}
            data-track-category='MESSAGE'
            data-track-name='APPROVE_SELECTED_TICKET_UPDATES'
            className='font-medium text-primary hover:underline disabled:opacity-50 bg-transparent border-none p-0'
          >
            Approve selected ({selectedIds.length})
          </button>
          <button
            onClick={approveAll}
            disabled={bulkBusy}
            data-track-category='MESSAGE'
            data-track-name='APPROVE_ALL_TICKET_UPDATES'
            className='font-medium text-primary hover:underline disabled:opacity-50 bg-transparent border-none p-0'
          >
            {bulkBusy ? 'Applying…' : `Approve all (${actionable.length})`}
          </button>
        </div>
      )}

      {updates.map(u => {
        const d = drafts[u.updateId] ?? draftFor(u);
        const ticket = ticketFor(u);
        const locked = ticket.state !== 'ready';
        const inFlightElsewhere = claimedByOther(u);
        const busy = bulkBusy || busyId === u.updateId || inFlightElsewhere;
        const disabled = busy || locked;
        const selected = selectedIds.includes(u.updateId);
        const stageOptions = stageOptionsFor(u);
        const canChangeStatus = u.restricted
          ? u.proposedStatusV2 !== null || stageOptions.length > 0
          : u.boardType !== 'FLOW' && stageOptions.length > 0;
        const blockedReason = ticket.state === 'locked' ? NO_ACCESS : undefined;
        return (
          <div
            key={u.updateId}
            className={`rounded-md border p-3 space-y-2 ${selected ? 'border-primary/60' : 'border-border'}`}
          >
            <div className='flex flex-wrap items-baseline gap-x-2 text-sm'>
              <input
                type='checkbox'
                checked={selected}
                disabled={bulkBusy || locked || inFlightElsewhere}
                onChange={() => toggleSelected(u.updateId)}
                aria-label={`Select ${ticket.xyneId || 'ticket update'}`}
                title={blockedReason}
                data-track-category='MESSAGE'
                data-track-name='TOGGLE_TICKET_UPDATE'
                className='h-4 w-4 rounded border-border self-center'
              />
              {locked ? (
                <span className='text-muted-foreground'>
                  {privateLabel(ticket.state)}
                  {ticket.state === 'locked' ? ` · ${NO_ACCESS.toLowerCase()}` : ''}
                </span>
              ) : (
                <button
                  onClick={() => openTicket(u.ticketId, ticket)}
                  data-track-category='MESSAGE'
                  data-track-name='OPEN_TICKET_FROM_UPDATE'
                  className='text-left hover:underline focus:outline-none bg-transparent border-none p-0'
                >
                  <span className='font-semibold text-primary'>{ticket.xyneId}</span>
                  <span className='mx-1.5 text-muted-foreground'>•</span>
                  <span className='text-foreground'>{ticket.title}</span>
                </button>
              )}
              <span className='text-xs text-muted-foreground'>
                {ticket.stageName}
                {u.matchedBy !== 'xyne-id'
                  ? ` · matched by ${u.matchedBy === 'title' ? 'topic' : 'number only'}`
                  : ''}
                {u.confidence < 0.7 ? ' · low confidence' : ''}
                {inFlightElsewhere ? ' · being applied…' : ''}
              </span>
            </div>

            <textarea
              value={d.text}
              disabled={disabled}
              rows={2}
              onChange={e => patch(u.updateId, { text: e.target.value })}
              className='w-full rounded border border-border bg-background px-2 py-1 text-sm'
            />

            {(u.speaker || u.quote) && (
              <div className='text-xs text-muted-foreground'>
                {u.speaker ? <span className='font-medium'>{u.speaker}</span> : null}
                {u.timestampSeconds !== null ? (
                  <span> at {formatTranscriptTimestamp(u.timestampSeconds)}</span>
                ) : null}
                {u.quote ? <span>: “{u.quote}”</span> : null}
              </div>
            )}

            <div className='flex flex-wrap items-center gap-x-4 gap-y-1 text-sm'>
              <label className='flex items-center gap-1.5 cursor-pointer'>
                <input
                  type='checkbox'
                  checked={d.postComment}
                  disabled={disabled}
                  onChange={e => patch(u.updateId, { postComment: e.target.checked })}
                  className='h-4 w-4 rounded border-border'
                />
                Post as comment on the ticket
              </label>
              {canChangeStatus && (
                <label className='flex items-center gap-1.5 cursor-pointer'>
                  <input
                    type='checkbox'
                    checked={d.changeStatus}
                    disabled={disabled}
                    onChange={e => patch(u.updateId, { changeStatus: e.target.checked })}
                    className='h-4 w-4 rounded border-border'
                  />
                  {stageOptions.length > 0 ? 'Move to' : 'Change status'}
                  {stageOptions.length > 0 && (
                    <select
                      value={d.stageName}
                      disabled={disabled || !d.changeStatus}
                      onChange={e => patch(u.updateId, { stageName: e.target.value })}
                      className='rounded border border-border bg-background px-1 py-0.5 text-sm'
                    >
                      <option value=''>choose stage…</option>
                      {stageOptions.map(s => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  )}
                  {u.proposedStatusV2 ? (
                    <span className='text-xs text-muted-foreground'>
                      (said: {u.proposedStatusV2.toLowerCase()})
                    </span>
                  ) : null}
                </label>
              )}
            </div>

            <div className='flex items-center gap-3'>
              <button
                onClick={() => void approve(u)}
                disabled={disabled}
                title={blockedReason}
                data-track-category='MESSAGE'
                data-track-name='APPROVE_TICKET_UPDATE'
                className='text-sm font-medium text-primary hover:underline disabled:opacity-50 bg-transparent border-none p-0'
              >
                {busyId === u.updateId ? 'Applying…' : 'Approve'}
              </button>
              <button
                onClick={() => void ignore(u)}
                disabled={disabled}
                title={blockedReason}
                data-track-category='MESSAGE'
                data-track-name='IGNORE_TICKET_UPDATE'
                className='text-sm text-muted-foreground hover:underline disabled:opacity-50 bg-transparent border-none p-0'
              >
                Ignore
              </button>
            </div>
          </div>
        );
      })}

      {ignored.length > 0 && (
        <div className='text-xs text-muted-foreground'>
          <button
            onClick={() => setShowIgnored(v => !v)}
            className='hover:underline bg-transparent border-none p-0 text-xs text-muted-foreground'
          >
            {showIgnored ? 'Hide' : 'Show'} {ignored.length} ignored
          </button>
          {showIgnored && (
            <ul className='mt-1 space-y-0.5'>
              {ignored.map(i => {
                const ticket = ticketFor(i);
                return (
                  <li key={i.updateId}>
                    {ticket.state === 'ready' ? (
                      <>
                        <span className='font-medium'>{ticket.xyneId}</span> · {ticket.title}
                      </>
                    ) : (
                      privateLabel(ticket.state)
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
