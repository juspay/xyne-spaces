import { useEffect, useState, type ReactElement } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { cn } from '../../utils/classNames';
import { logger, Event as LogEvent } from '../../utils/logger';
import { sendAgentFeedback, type AgentFeedbackValue } from '../../api/agentFeedbackApi';

/**
 * Per-message 👍 / 👎 on an agent (BOT / APP) reply — no-DB, telemetry-only.
 *
 * There is no feedback table: the click posts to
 * `POST /api/messages/:messageId/feedback`, whose handler resolves the agent
 * name server-side and emits a structured `agent_feedback` log line
 * (VictoriaLogs, groupable by agentName). Because nothing is persisted:
 *   - button state is kept in localStorage (survives refresh on THIS device only)
 *   - repeat clicks are de-duped client-side (one signal per value per message)
 * This is an MVP signal, not an authoritative counter — see the PR description.
 *
 * Rendered only for agent-authored messages; the caller gates on sender type.
 */
type Selected = AgentFeedbackValue | null;

const storageKey = (messageId: string): string => `agent_feedback:${messageId}`;

function readStored(messageId: string): Selected {
  try {
    const v = localStorage.getItem(storageKey(messageId));
    return v === 'like' || v === 'unlike' ? v : null;
  } catch {
    return null;
  }
}

export function AgentFeedbackButtons({
  messageId,
  agentName,
  className,
}: {
  messageId: string;
  /** Best-effort label for local logging only; the backend re-resolves the
   *  authoritative name server-side, so this cannot be spoofed into telemetry. */
  agentName?: string | undefined;
  className?: string | undefined;
}): ReactElement {
  const [selected, setSelected] = useState<Selected>(() => readStored(messageId));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(readStored(messageId));
  }, [messageId]);

  const submit = async (value: AgentFeedbackValue): Promise<void> => {
    // Client-side dedupe: one signal per value per message on this device.
    if (saving || selected === value) return;
    const previous = selected;
    setSelected(value); // optimistic
    setSaving(true);
    try {
      await sendAgentFeedback(messageId, value);
      try {
        localStorage.setItem(storageKey(messageId), value);
      } catch {
        // ignore quota/availability errors — telemetry already sent
      }
      logger.info(LogEvent.AGENT_FEEDBACK, { value, messageId, agentName });
    } catch (error) {
      setSelected(previous); // revert
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'agent_feedback_failed',
        message: '[AgentFeedbackButtons] failed to send feedback',
        error,
      });
    } finally {
      setSaving(false);
    }
  };

  const isLike = selected === 'like';
  const isUnlike = selected === 'unlike';

  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      <button
        type='button'
        onClick={(): void => void submit('like')}
        disabled={saving}
        title='Helpful'
        aria-pressed={isLike}
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
          isLike ? 'text-foreground' : 'text-muted-foreground',
        )}
        data-track-category='AgentFeedback'
        data-track-name='LIKE_AGENT_MESSAGE'
      >
        <ThumbsUp
          className='h-3.5 w-3.5'
          aria-hidden
          strokeWidth={1.75}
          fill={isLike ? 'currentColor' : 'none'}
          fillOpacity={isLike ? 0.3 : 1}
        />
      </button>
      <button
        type='button'
        onClick={(): void => void submit('unlike')}
        disabled={saving}
        title='Not helpful'
        aria-pressed={isUnlike}
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
          isUnlike ? 'text-foreground' : 'text-muted-foreground',
        )}
        data-track-category='AgentFeedback'
        data-track-name='UNLIKE_AGENT_MESSAGE'
      >
        <ThumbsDown
          className='h-3.5 w-3.5'
          aria-hidden
          strokeWidth={1.75}
          fill={isUnlike ? 'currentColor' : 'none'}
          fillOpacity={isUnlike ? 0.3 : 1}
        />
      </button>
    </span>
  );
}
