import React, { useEffect, useMemo, useState } from 'react';
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
  const [showIgnored, setShowIgnored] = useState(false);

  // Seed a draft per pending row; keep the user's edits across re-renders.
  useEffect(() => {
    setDrafts(prev => {
      const next: Record<string, RowDraft> = {};
      for (const u of updates) next[u.updateId] = prev[u.updateId] ?? draftFor(u);
      return next;
    });
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

  const approve = async (u: TicketUpdateProposal) => {
    const d = drafts[u.updateId] ?? draftFor(u);
    if (!d.postComment && !d.changeStatus) {
      toast.error('Choose the comment, the status change, or both');
      return;
    }
    if (d.changeStatus && !d.stageName) {
      toast.error('Pick the stage to move the ticket to');
      return;
    }
    setBusyId(u.updateId);
    try {
      await callService.applyTicketUpdate(callId, u.updateId, {
        postComment: d.postComment,
        changeStatus: d.changeStatus,
        message: d.text,
        ...(d.changeStatus ? { stageName: d.stageName } : {}),
      });
      toast.success(
        d.changeStatus
          ? `${u.xyneId}: comment posted, moved to ${d.stageName}`
          : `${u.xyneId}: comment posted`,
      );
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'ticket_update_apply',
        message: String(error),
        error,
      });
      toast.error(error instanceof Error ? error.message : 'Failed to apply the update');
    } finally {
      setBusyId(null);
    }
  };

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

  const appliedRows = useMemo(() => applied, [applied]);

  if (updates.length === 0 && applied.length === 0 && ignored.length === 0) return null;

  return (
    <div className='mt-3 pl-2 -ml-8 space-y-3'>
      {appliedRows.map(a => (
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

      {updates.map(u => {
        const d = drafts[u.updateId] ?? draftFor(u);
        const busy = busyId === u.updateId;
        const canChangeStatus = u.boardType !== 'FLOW' && u.stageOptions.length > 0;
        return (
          <div key={u.updateId} className='rounded-md border border-border p-3 space-y-2'>
            <div className='flex flex-wrap items-baseline gap-x-2 text-sm'>
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
