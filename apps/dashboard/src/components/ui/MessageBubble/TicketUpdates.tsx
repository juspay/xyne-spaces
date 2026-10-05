import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Lock,
  Pencil,
  X,
} from 'lucide-react';
import {
  BoardType,
  formatCallTimestamp,
  isTicketUpdateClaimFresh,
  resolveStageForStatus,
  ticketUpdateCommentSource,
} from '@xyne/shared';
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
import { Button } from '../Button';
import { Checkbox } from '../Checkbox/Checkbox';
import { Textarea } from '../Textarea';
import {
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

/** What approving a row will do. An empty `stageName` means the stage is left alone. */
interface RowDraft {
  text: string;
  postComment: boolean;
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

// The card carries the board type as plain text.
const FLOW_BOARD: string = BoardType.FLOW;
const NO_ACCESS = "You don't have access to this ticket";
const FIELD_LABEL = 'pt-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground';
const FIELD_GRID = 'grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5';

const draftFor = (u: TicketUpdateProposal): RowDraft => ({
  text: u.update,
  postComment: true,
  stageName: u.boardType === FLOW_BOARD ? '' : (u.proposedStageName ?? ''),
});

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

/** A cleared comment box posts nothing, the same as unticking the checkbox. */
const postsComment = (d: RowDraft): boolean => d.postComment && d.text.trim() !== '';

const StageChange: React.FC<{ from: string; to: string }> = ({ from, to }) => (
  <span className='inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-foreground'>
    {from}
    <ArrowRight className='size-3 text-muted-foreground' />
    {to}
  </span>
);

/**
 * Review card for updates to EXISTING tickets that were said during a call.
 * Each row can be approved (posts the note on the ticket thread and/or moves the
 * ticket's stage, both as the signed-in user) or ignored. State lives in the
 * message content, so every participant sees the same card.
 *
 * A row has three depths. Collapsed it is one line: the ticket and its stage move.
 * Open it also spells out the two things approving will do, labelled Comment and
 * Stage. Editing turns those two into inputs, already filled with the proposal.
 *
 * A ticket from outside the call's channel arrives without its identity: the row
 * is filled in from the viewer's own synced tickets, and stays locked for a
 * viewer who cannot read that ticket.
 */
export const TicketUpdates: React.FC<TicketUpdatesProps> = ({
  callId,
  channelId,
  messageId,
  updates: syncedUpdates,
  applied,
  ignored,
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Rows this user just approved or ignored: hidden at once, so a second click
  // cannot race the sync that removes them from the message content.
  const [handledIds, setHandledIds] = useState<string[]>([]);
  const updates = useMemo(
    () => syncedUpdates.filter(u => !handledIds.includes(u.updateId)),
    [syncedUpdates, handledIds],
  );
  const markHandled = (id: string): void => setHandledIds(prev => [...prev, id]);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  // Rows whose stage the user set by hand: never overwritten by a later prefill.
  const [stageTouchedIds, setStageTouchedIds] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingIds, setEditingIds] = useState<string[]>([]);
  // The card is posted collapsed: a scannable list of tickets and their stage moves.
  const [collapsedAll, setCollapsedAll] = useState(true);
  // Rows opened or closed individually, against the collapse-all setting.
  const [rowOpen, setRowOpen] = useState<Record<string, boolean>>({});
  const [showHandled, setShowHandled] = useState(false);
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

  // The card carries no board details for a restricted ticket, so its stages come
  // from the viewer's own sync, like the ticket itself.
  const restrictedBoardIds = useMemo(
    () =>
      Array.from(
        new Set((restrictedTickets ?? []).map(t => t.boardId).filter((id): id is string => !!id)),
      ),
    [restrictedTickets],
  );
  const [restrictedStages] = useQuery(
    queries.getStagesByBoardIds({ boardIds: restrictedBoardIds }),
    { enabled: restrictedBoardIds.length > 0 },
  );
  const stagesByBoard = useMemo(() => {
    const byBoard = new Map<string, NonNullable<typeof restrictedStages>[number][]>();
    for (const stage of restrictedStages ?? []) {
      byBoard.set(stage.boardId, [...(byBoard.get(stage.boardId) ?? []), stage]);
    }
    return byBoard;
  }, [restrictedStages]);

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

  const stageOptionsFor = (u: TicketUpdateProposal): string[] => {
    const offered = offeredStages[u.updateId];
    if (offered) return offered;
    if (!u.restricted) return u.stageOptions;
    const ticket = restrictedById.get(u.ticketId);
    if (!ticket) return [];
    return (stagesByBoard.get(ticket.boardId) ?? [])
      .map(s => s.name)
      .filter(name => name !== ticket.stageName);
  };

  const claimedByOther = (u: TicketUpdateProposal): boolean =>
    isTicketUpdateClaimFresh(u.claim) && u.claim.by !== user?.id;
  // A claim expires on the clock, not on a sync: tick while one is live so its
  // row unlocks without waiting for something else to re-render the card.
  const [, setClaimTick] = useState(0);
  const hasLiveClaim = updates.some(u => isTicketUpdateClaimFresh(u.claim));
  useEffect(() => {
    if (!hasLiveClaim) return;
    const timer = setInterval(() => setClaimTick(tick => tick + 1), 5_000);
    return (): void => clearInterval(timer);
  }, [hasLiveClaim]);
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

  // Prefill the stage of a restricted row once its board's stages have synced, the
  // same way the backend does for a ticket in the call's own channel.
  useEffect(() => {
    setDrafts(prev => {
      let next = prev;
      for (const u of updates) {
        if (
          !u.restricted ||
          u.boardType === FLOW_BOARD ||
          !u.proposedStatusV2 ||
          stageTouchedIds.includes(u.updateId)
        )
          continue;
        const draft = prev[u.updateId];
        const ticket = restrictedById.get(u.ticketId);
        if (!draft || draft.stageName || !ticket) continue;
        const resolved = resolveStageForStatus(
          stagesByBoard.get(ticket.boardId) ?? [],
          ticket.stageName,
          u.proposedStatusV2,
        );
        if (!resolved) continue;
        next = { ...next, [u.updateId]: { ...draft, stageName: resolved } };
      }
      return next;
    });
  }, [updates, restrictedById, stagesByBoard, stageTouchedIds]);

  // The line the server appends to a posted comment, so the preview shows the
  // whole comment. Unknown for a viewer who cannot read the call itself.
  const [call] = useQuery(queries.callByExternalId({ callId }));
  const commentSourceFor = (u: TicketUpdateProposal): string | null =>
    call
      ? ticketUpdateCommentSource({
          callTitle: call.title ?? null,
          callStartedAt: call.startedAt,
          when: u.timestampSeconds !== null ? formatCallTimestamp(u.timestampSeconds) : null,
          speaker: u.speaker,
        })
      : null;

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
      [id]: { ...(prev[id] ?? { text: '', postComment: true, stageName: '' }), ...changes },
    }));

  const setStage = (id: string, stageName: string): void => {
    setStageTouchedIds(prev => (prev.includes(id) ? prev : [...prev, id]));
    patch(id, { stageName });
  };

  const openEditor = (id: string): void =>
    setEditingIds(prev => (prev.includes(id) ? prev : [...prev, id]));
  const toggleEditor = (id: string): void =>
    setEditingIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const isOpen = (id: string): boolean => editingIds.includes(id) || (rowOpen[id] ?? !collapsedAll);
  const toggleRow = (id: string): void => {
    const open = isOpen(id);
    if (open) setEditingIds(prev => prev.filter(x => x !== id));
    setRowOpen(prev => ({ ...prev, [id]: !open }));
  };
  const toggleAll = (): void => {
    setCollapsedAll(v => !v);
    setRowOpen({});
    setEditingIds([]);
  };

  const openTicket = (ticketId: string, ticket: RowTicket): void => {
    void navigate(
      `/chat/dir/${ticket.channelId}/${ticket.conversationId}/${ticketId}?selectedTab=details`,
      { state: { trackSource: 'chat_message' } },
    );
  };

  /** Apply one row with its current draft. */
  const applyOne = async (
    u: TicketUpdateProposal,
  ): Promise<{ error: string } | { result: AppliedTicketUpdateResult }> => {
    const d = drafts[u.updateId] ?? draftFor(u);
    const changeStatus = d.stageName !== '';
    const postComment = postsComment(d);
    if (!postComment && !changeStatus) {
      openEditor(u.updateId);
      return { error: 'nothing to apply: no comment and no stage change' };
    }
    try {
      const result = await callService.applyTicketUpdate(callId, u.updateId, {
        postComment,
        changeStatus,
        message: d.text,
        ...(changeStatus ? { stageName: d.stageName } : {}),
      });
      markHandled(u.updateId);
      return { result };
    } catch (error) {
      if (error instanceof TicketUpdateApplyError && error.stageOptions.length > 0) {
        const options = error.stageOptions;
        setOfferedStages(prev => ({ ...prev, [u.updateId]: options }));
        // The fix is a stage choice, so put the picker in front of the user.
        openEditor(u.updateId);
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
    if (done > 0) toast.success(`Applied ${plural(done, 'ticket update')}`);
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
      toast.info(`Skipping ${plural(lockedCount, 'private ticket')} you don't have access to`);
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
      markHandled(u.updateId);
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

  // The synced rows decide whether there is a card at all, so it does not blink
  // out between hiding the last row here and its outcome arriving.
  if (syncedUpdates.length === 0 && applied.length === 0 && ignored.length === 0) return null;

  const selectable = actionable.length > 1;
  const handledCount = applied.length + ignored.length;
  // With nothing left to review, the outcome is the whole card: show it open.
  const handledOpen = showHandled || updates.length === 0;
  const handledSummary = [
    applied.length > 0 ? `${applied.length} applied` : '',
    ignored.length > 0 ? `${ignored.length} ignored` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const ticketLabel = (ticketId: string, ticket: RowTicket): React.ReactNode =>
    ticket.state === 'ready' ? (
      <button
        onClick={() => openTicket(ticketId, ticket)}
        data-track-category='MESSAGE'
        data-track-name='OPEN_TICKET_FROM_UPDATE'
        className='min-w-0 truncate bg-transparent border-none p-0 text-left text-sm hover:underline focus:outline-none'
      >
        <span className='font-medium text-primary'>{ticket.xyneId}</span>
        <span className='ml-2 text-foreground'>{ticket.title}</span>
      </button>
    ) : (
      <span className='inline-flex items-center gap-1.5 text-sm text-muted-foreground'>
        <Lock className='size-3.5' />
        {ticket.state === 'loading' ? 'Loading ticket…' : 'Private ticket'}
      </span>
    );

  return (
    <div className='mt-3 pl-2 -ml-8'>
      {updates.length > 0 && (
        <>
          {updates.length > 1 && (
            <div className='mb-2 flex items-center justify-between gap-3'>
              {selectable ? (
                <Checkbox
                  size='sm'
                  checked={allSelected}
                  indeterminate={selectedIds.length > 0 && !allSelected}
                  disabled={bulkBusy}
                  onChange={toggleSelectAll}
                  label={
                    selectedIds.length > 0
                      ? `${selectedIds.length} selected`
                      : plural(updates.length, 'update')
                  }
                  ariaLabel='Select all ticket updates'
                  data-track-category='MESSAGE'
                  data-track-name='SELECT_ALL_TICKET_UPDATES'
                />
              ) : (
                <span className='text-xs text-muted-foreground'>
                  {plural(updates.length, 'update')}
                </span>
              )}
              <div className='flex items-center gap-1'>
                <Button
                  size='sm'
                  variant='ghost'
                  className='text-muted-foreground'
                  onClick={toggleAll}
                  data-track-category='MESSAGE'
                  data-track-name={
                    collapsedAll ? 'EXPAND_ALL_TICKET_UPDATES' : 'COLLAPSE_ALL_TICKET_UPDATES'
                  }
                >
                  {collapsedAll ? <ChevronsUpDown /> : <ChevronsDownUp />}
                  {collapsedAll ? 'Expand all' : 'Collapse all'}
                </Button>
                {selectable &&
                  (selectedIds.length > 0 ? (
                    <Button
                      size='sm'
                      loading={bulkBusy}
                      disabled={bulkBusy}
                      onClick={() =>
                        void approveMany(actionable.filter(u => selectedIds.includes(u.updateId)))
                      }
                      data-track-category='MESSAGE'
                      data-track-name='APPROVE_SELECTED_TICKET_UPDATES'
                    >
                      Approve selected
                    </Button>
                  ) : (
                    <Button
                      size='sm'
                      variant='outline'
                      loading={bulkBusy}
                      disabled={bulkBusy}
                      onClick={approveAll}
                      data-track-category='MESSAGE'
                      data-track-name='APPROVE_ALL_TICKET_UPDATES'
                    >
                      Approve all
                    </Button>
                  ))}
              </div>
            </div>
          )}

          <div className='divide-y divide-border rounded-lg border border-border'>
            {updates.map(u => {
              const d = drafts[u.updateId] ?? draftFor(u);
              const ticket = ticketFor(u);
              const locked = ticket.state !== 'ready';
              const inFlightElsewhere = claimedByOther(u);
              const rowBusy = busyId === u.updateId;
              const disabled = bulkBusy || rowBusy || inFlightElsewhere || locked;
              const editing = editingIds.includes(u.updateId) && !locked;
              const open = isOpen(u.updateId);
              const stageOptions = stageOptionsFor(u);
              const canChangeStage = u.boardType !== FLOW_BOARD && stageOptions.length > 0;
              // The status was said out loud but no stage on the board stands for it.
              const unmatchedStatus =
                !d.stageName && u.proposedStatusV2 ? u.proposedStatusV2.toLowerCase() : '';
              const hint = [
                u.matchedBy === 'title' ? 'matched by topic' : '',
                u.matchedBy === 'number-only' ? 'matched by number only' : '',
                u.confidence < 0.7 ? 'low confidence' : '',
                inFlightElsewhere ? 'being applied…' : '',
              ]
                .filter(Boolean)
                .join(' · ');
              const indent = selectable ? 'ml-[46px]' : 'ml-6';

              return (
                <div key={u.updateId} className='px-3 py-2'>
                  {/* min-h matches the action buttons, so a locked row (which has
                      none) is exactly as tall as one you can act on. */}
                  <div className='flex min-h-8 items-center gap-2'>
                    {selectable && (
                      <Checkbox
                        size='sm'
                        checked={selectedIds.includes(u.updateId)}
                        disabled={bulkBusy || locked || inFlightElsewhere}
                        onChange={() => toggleSelected(u.updateId)}
                        label=''
                        ariaLabel={`Select ${ticket.xyneId || 'ticket update'}`}
                        data-track-category='MESSAGE'
                        data-track-name='TOGGLE_TICKET_UPDATE'
                      />
                    )}
                    <button
                      onClick={() => toggleRow(u.updateId)}
                      aria-expanded={open}
                      aria-label={open ? 'Collapse update' : 'Expand update'}
                      data-track-category='MESSAGE'
                      data-track-name='TOGGLE_TICKET_UPDATE_DETAILS'
                      className='shrink-0 bg-transparent border-none p-0 text-muted-foreground hover:text-foreground'
                    >
                      {open ? (
                        <ChevronDown className='size-4' />
                      ) : (
                        <ChevronRight className='size-4' />
                      )}
                    </button>
                    <div className='flex min-w-0 flex-1 items-center'>
                      {ticketLabel(u.ticketId, ticket)}
                    </div>
                    {/* A fixed column, so the stage moves line up down the list and
                        sit centred in it whatever the title length. */}
                    {!open && !locked && (
                      <div className='flex w-44 shrink-0 items-center justify-center'>
                        {d.stageName && <StageChange from={ticket.stageName} to={d.stageName} />}
                      </div>
                    )}

                    {!locked && (
                      <div className='flex shrink-0 items-center gap-0.5'>
                        <Button
                          size='sm'
                          variant='ghost'
                          className='text-primary'
                          loading={rowBusy && !bulkBusy}
                          disabled={disabled}
                          onClick={() => void approve(u)}
                          data-track-category='MESSAGE'
                          data-track-name='APPROVE_TICKET_UPDATE'
                        >
                          Approve
                        </Button>
                        <Button
                          size='iconSm'
                          variant='ghost'
                          className={editing ? 'text-foreground' : 'text-muted-foreground'}
                          aria-label={editing ? 'Done editing' : 'Edit comment and stage'}
                          title={editing ? 'Done editing' : 'Edit comment and stage'}
                          aria-expanded={editing}
                          disabled={disabled}
                          onClick={() => toggleEditor(u.updateId)}
                          data-track-category='MESSAGE'
                          data-track-name='EDIT_TICKET_UPDATE'
                        >
                          {editing ? <Check className='size-4' /> : <Pencil className='size-3.5' />}
                        </Button>
                        <Button
                          size='iconSm'
                          variant='ghost'
                          className='text-muted-foreground'
                          aria-label='Ignore this update'
                          title='Ignore'
                          disabled={disabled}
                          onClick={() => void ignore(u)}
                          data-track-category='MESSAGE'
                          data-track-name='IGNORE_TICKET_UPDATE'
                        >
                          <X className='size-4' />
                        </Button>
                      </div>
                    )}
                  </div>

                  {open && locked && (
                    <div className={`mt-1 ${indent}`}>
                      <p className='text-sm text-muted-foreground/70'>{d.text}</p>
                      {ticket.state === 'locked' && (
                        <p className='mt-1 text-xs text-muted-foreground'>{NO_ACCESS}</p>
                      )}
                    </div>
                  )}

                  {open && !locked && !editing && (
                    <div className={`mt-1.5 ${indent}`}>
                      <dl className={FIELD_GRID}>
                        <dt className={FIELD_LABEL}>Comment</dt>
                        <dd className='text-sm'>
                          {postsComment(d) ? (
                            <>
                              <span className='text-foreground'>{d.text}</span>
                              {commentSourceFor(u) && (
                                <span className='mt-0.5 block text-xs italic text-muted-foreground'>
                                  {commentSourceFor(u)}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className='text-muted-foreground'>Not posting a comment</span>
                          )}
                        </dd>
                        <dt className={FIELD_LABEL}>Stage</dt>
                        <dd className='text-sm'>
                          {d.stageName ? (
                            <StageChange from={ticket.stageName} to={d.stageName} />
                          ) : (
                            <span className='text-muted-foreground'>
                              Stays in {ticket.stageName || 'its current stage'}
                              {unmatchedStatus
                                ? ` · "${unmatchedStatus}" was said, but no stage matches`
                                : ''}
                            </span>
                          )}
                        </dd>
                      </dl>
                      {hint && <p className='mt-1.5 text-xs text-muted-foreground'>{hint}</p>}
                    </div>
                  )}

                  {editing && (
                    <div className={`mt-2 ${indent}`}>
                      <div className={FIELD_GRID}>
                        <label
                          htmlFor={`ticket-update-comment-${u.updateId}`}
                          className={FIELD_LABEL}
                        >
                          Comment
                        </label>
                        <div className='space-y-1.5'>
                          <Textarea
                            id={`ticket-update-comment-${u.updateId}`}
                            value={d.text}
                            disabled={disabled || !d.postComment}
                            rows={2}
                            onChange={e => patch(u.updateId, { text: e.target.value })}
                            className='text-sm'
                          />
                          {postsComment(d) && commentSourceFor(u) && (
                            <p className='text-xs italic text-muted-foreground'>
                              {commentSourceFor(u)}
                            </p>
                          )}
                          <Checkbox
                            size='sm'
                            checked={d.postComment}
                            disabled={disabled}
                            onChange={checked => patch(u.updateId, { postComment: checked })}
                            label='Post this as a comment on the ticket'
                          />
                        </div>

                        <label
                          htmlFor={`ticket-update-stage-${u.updateId}`}
                          className={FIELD_LABEL}
                        >
                          Stage
                        </label>
                        <div className='flex flex-wrap items-center gap-2 text-sm'>
                          <span className='text-muted-foreground'>{ticket.stageName}</span>
                          <ArrowRight className='size-3.5 text-muted-foreground' />
                          <select
                            id={`ticket-update-stage-${u.updateId}`}
                            value={d.stageName}
                            disabled={disabled || !canChangeStage}
                            onChange={e => setStage(u.updateId, e.target.value)}
                            className='rounded-md border border-border bg-background px-2 py-1 text-sm disabled:opacity-50'
                          >
                            <option value=''>No change</option>
                            {stageOptions.map(s => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                          {unmatchedStatus && canChangeStage && (
                            <span className='text-xs text-muted-foreground'>
                              “{unmatchedStatus}” was said; pick the stage for it
                            </span>
                          )}
                          {u.boardType === FLOW_BOARD && (
                            <span className='text-xs text-muted-foreground'>
                              Flow boards move through their own transitions
                            </span>
                          )}
                        </div>
                      </div>
                      {u.quote && (
                        <p className='mt-2.5 border-l-2 border-border pl-2 text-xs text-muted-foreground'>
                          “{u.quote}”{u.speaker ? ` ${u.speaker}` : ''}
                          {u.timestampSeconds !== null
                            ? `, ${formatCallTimestamp(u.timestampSeconds)}`
                            : ''}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {handledCount > 0 && (
        <div className={updates.length > 0 ? 'mt-2' : ''}>
          {updates.length > 0 && (
            <button
              onClick={() => setShowHandled(v => !v)}
              aria-expanded={handledOpen}
              className='inline-flex items-center gap-1 bg-transparent border-none p-0 text-xs text-muted-foreground hover:text-foreground'
            >
              {handledOpen ? (
                <ChevronDown className='size-3.5' />
              ) : (
                <ChevronRight className='size-3.5' />
              )}
              {handledSummary}
            </button>
          )}
          {handledOpen && (
            <ul className={`space-y-1.5 ${updates.length > 0 ? 'mt-1.5' : ''}`}>
              {applied.map(a => {
                const ticket = ticketFor(a);
                const outcome = [
                  a.commentMessageId ? 'commented' : '',
                  a.newStageName ? `moved to ${a.newStageName}` : '',
                  a.stagePendingApproval
                    ? `move to ${a.stagePendingApproval} awaiting approval`
                    : '',
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <li key={a.updateId} className='flex min-w-0 items-center gap-2 text-sm'>
                    <Check className='size-3.5 shrink-0 text-status-success' />
                    {ticketLabel(a.ticketId, ticket)}
                    <span className='shrink-0 text-xs text-muted-foreground'>
                      {outcome || 'applied'}
                    </span>
                  </li>
                );
              })}
              {ignored.map(i => {
                const ticket = ticketFor(i);
                return (
                  <li
                    key={i.updateId}
                    className='flex min-w-0 items-center gap-2 text-sm text-muted-foreground'
                  >
                    <X className='size-3.5 shrink-0' />
                    <span className='min-w-0 truncate'>
                      {ticket.state === 'ready'
                        ? `${ticket.xyneId} ${ticket.title}`
                        : ticket.state === 'loading'
                          ? 'Loading ticket…'
                          : 'Private ticket'}
                    </span>
                    <span className='shrink-0 text-xs'>ignored</span>
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
