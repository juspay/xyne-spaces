import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { logger, Event as LogEvent } from '../../../utils/logger';
import { callService } from '../../../services/Call/callService';
import { globalClickTracker } from '../../../services/Analytics/globalClickTracker';
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
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showIgnored, setShowIgnored] = useState(false);

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

  const patch = (id: string, changes: Partial<RowDraft>) =>
    setDrafts(prev => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? { text: '', postComment: true, changeStatus: false, stageName: '' }),
        ...changes,
      },
    }));

  const openTicket = (ticketId: string, conversationId: string) => {
    void navigate(`/chat/dir/${channelId}/${conversationId}/${ticketId}?selectedTab=details`, {
      state: { trackSource: 'chat_message' },
    });
  };

  /** Apply one row with its current draft. Returns an error message, or null on success. */
  const applyOne = async (u: TicketUpdateProposal): Promise<string | null> => {
    const d = drafts[u.updateId] ?? draftFor(u);
    if (!d.postComment && !d.changeStatus) return 'nothing selected to apply';
    if (d.changeStatus && !d.stageName) return 'no stage chosen';
    try {
      await callService.applyTicketUpdate(callId, u.updateId, {
        postComment: d.postComment,
        changeStatus: d.changeStatus,
        message: d.text,
        ...(d.changeStatus ? { stageName: d.stageName } : {}),
      });
      return null;
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'ticket_update_apply',
        message: String(error),
        error,
      });
      return error instanceof Error ? error.message : 'failed to apply';
    }
  };

  const approve = async (u: TicketUpdateProposal) => {
    setBusyId(u.updateId);
    try {
      const error = await applyOne(u);
      if (error) {
        toast.error(`${u.xyneId}: ${error}`);
        return;
      }
      const d = drafts[u.updateId] ?? draftFor(u);
      toast.success(
        d.changeStatus
          ? `${u.xyneId}: comment posted, moved to ${d.stageName}`
          : `${u.xyneId}: comment posted`,
      );
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Approve several rows one after another: every approval rewrites the card
   * message, so running them in parallel would lose updates.
   */
  const approveMany = async (rows: TicketUpdateProposal[]) => {
    if (rows.length === 0) return;
    setBulkBusy(true);
    const failures: string[] = [];
    let done = 0;
    try {
      for (const u of rows) {
        setBusyId(u.updateId);
        const error = await applyOne(u);
        if (error) failures.push(`${u.xyneId}: ${error}`);
        else done += 1;
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

  const toggleSelected = (id: string) =>
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  const allSelected = updates.length > 0 && selectedIds.length === updates.length;
  const toggleSelectAll = () => setSelectedIds(allSelected ? [] : updates.map(u => u.updateId));

  const ignore = async (u: TicketUpdateProposal) => {
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

  return (
    <div className='mt-3 pl-2 -ml-8 space-y-3'>
      {applied.map(a => (
        <div key={a.updateId} className='text-sm'>
          <button
            onClick={() => openTicket(a.ticketId, a.ticketConversationId)}
            data-track-category='MESSAGE'
            data-track-name='OPEN_TICKET_FROM_UPDATE'
            className='text-left hover:underline focus:outline-none bg-transparent border-none p-0'
          >
            <span className='font-semibold text-primary'>{a.xyneId}</span>
            <span className='mx-1.5 text-muted-foreground'>•</span>
            <span className='text-foreground'>{a.title}</span>
          </button>
          <span className='ml-2 text-xs text-muted-foreground'>
            {a.commentMessageId ? 'commented' : ''}
            {a.commentMessageId && a.newStageName ? ' · ' : ''}
            {a.newStageName ? `moved to ${a.newStageName}` : ''}
          </span>
        </div>
      ))}

      {updates.length > 1 && (
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
            onClick={() => void approveMany(updates.filter(u => selectedIds.includes(u.updateId)))}
            disabled={bulkBusy || selectedIds.length === 0}
            data-track-category='MESSAGE'
            data-track-name='APPROVE_SELECTED_TICKET_UPDATES'
            className='font-medium text-primary hover:underline disabled:opacity-50 bg-transparent border-none p-0'
          >
            Approve selected ({selectedIds.length})
          </button>
          <button
            onClick={() => void approveMany(updates)}
            disabled={bulkBusy}
            data-track-category='MESSAGE'
            data-track-name='APPROVE_ALL_TICKET_UPDATES'
            className='font-medium text-primary hover:underline disabled:opacity-50 bg-transparent border-none p-0'
          >
            {bulkBusy ? 'Applying…' : `Approve all (${updates.length})`}
          </button>
        </div>
      )}

      {updates.map(u => {
        const d = drafts[u.updateId] ?? draftFor(u);
        const busy = bulkBusy || busyId === u.updateId;
        const selected = selectedIds.includes(u.updateId);
        const canChangeStatus = u.boardType !== 'FLOW' && u.stageOptions.length > 0;
        return (
          <div
            key={u.updateId}
            className={`rounded-md border p-3 space-y-2 ${selected ? 'border-primary/60' : 'border-border'}`}
          >
            <div className='flex flex-wrap items-baseline gap-x-2 text-sm'>
              <input
                type='checkbox'
                checked={selected}
                disabled={bulkBusy}
                onChange={() => toggleSelected(u.updateId)}
                aria-label={`Select ${u.xyneId}`}
                data-track-category='MESSAGE'
                data-track-name='TOGGLE_TICKET_UPDATE'
                className='h-4 w-4 rounded border-border self-center'
              />
              <button
                onClick={() => openTicket(u.ticketId, u.ticketConversationId)}
                data-track-category='MESSAGE'
                data-track-name='OPEN_TICKET_FROM_UPDATE'
                className='text-left hover:underline focus:outline-none bg-transparent border-none p-0'
              >
                <span className='font-semibold text-primary'>{u.xyneId}</span>
                <span className='mx-1.5 text-muted-foreground'>•</span>
                <span className='text-foreground'>{u.title}</span>
              </button>
              <span className='text-xs text-muted-foreground'>
                {u.currentStageName}
                {u.matchedBy !== 'xyne-id'
                  ? ` · matched by ${u.matchedBy === 'title' ? 'topic' : 'number only'}`
                  : ''}
                {u.confidence < 0.7 ? ' · low confidence' : ''}
              </span>
            </div>

            <textarea
              value={d.text}
              disabled={busy}
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
                  disabled={busy}
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
                    disabled={busy}
                    onChange={e => patch(u.updateId, { changeStatus: e.target.checked })}
                    className='h-4 w-4 rounded border-border'
                  />
                  Move to
                  <select
                    value={d.stageName}
                    disabled={busy || !d.changeStatus}
                    onChange={e => patch(u.updateId, { stageName: e.target.value })}
                    className='rounded border border-border bg-background px-1 py-0.5 text-sm'
                  >
                    <option value=''>choose stage…</option>
                    {u.stageOptions.map(s => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
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
                disabled={busy}
                data-track-category='MESSAGE'
                data-track-name='APPROVE_TICKET_UPDATE'
                className='text-sm font-medium text-primary hover:underline disabled:opacity-50 bg-transparent border-none p-0'
              >
                {busy ? 'Applying…' : 'Approve'}
              </button>
              <button
                onClick={() => void ignore(u)}
                disabled={busy}
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
              {ignored.map(i => (
                <li key={i.updateId}>
                  <span className='font-medium'>{i.xyneId}</span> · {i.title}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
