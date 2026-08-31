import { logger, Event as LogEvent } from '../../utils/logger';
import { useEffect, useState, type ReactElement } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { Button } from '../ui/Button/Button';
import { cn } from '../../utils/classNames';
import { rateV2Message } from '../../services/XyneAI/XyneAISessionsV2Service';

type FeedbackNum = 0 | 1 | 2; // 0 = none, 1 = like, 2 = dislike

/** Max length of the optional dislike comment (chars). Enforced in the input
 *  and re-clamped on submit; the backend clamps too as defense in depth. */
const MAX_COMMENT_LEN = 500;

/**
 * Ask-AI v2 per-message 👍/👎 control. Persists to the claw AgentRun that
 * produced the message (via `messageId` = the assistant ChatMessage id) through
 * `rateV2Message`, so the signal lands in agent_runs.rating — the same store
 * that feeds the claw metrics SentimentPanel and seeds the thumb state on
 * reload. Keying on the message id (not the run sessionId) means the control is
 * usable the instant a turn completes, with no wait on a /messages refetch.
 *
 * Mirrors the standalone claw chat's MessageRatingButtons: rating is set (not
 * toggled off — the claw rate endpoint has no "clear"), and 👎 reveals an
 * optional inline comment. Shared by AIChatThread and XyneAISidebar.
 */
export function AskAiRatingButtons({
  messageId,
  feedback,
  comment,
  onChange,
  className,
}: {
  /** Assistant ChatMessage id. Absent only mid-stream (buttons aren't shown
   *  then); once the turn completes it's the server id, so rating always works. */
  messageId?: string | undefined;
  feedback?: FeedbackNum | undefined;
  comment?: string | null | undefined;
  /** Lets the parent reflect the new rating in its message state. */
  onChange?: ((feedback: FeedbackNum, comment?: string | null) => void) | undefined;
  className?: string | undefined;
}): ReactElement {
  const [current, setCurrent] = useState<FeedbackNum>(feedback ?? 0);
  const [saving, setSaving] = useState(false);
  const [showComment, setShowComment] = useState(false);
  const [commentText, setCommentText] = useState(comment ?? '');

  // Re-sync from props when the persisted rating changes (e.g. after a reload /
  // post-turn refresh), unless the user is mid-save or editing a comment.
  useEffect(() => {
    if (!saving && !showComment) {
      setCurrent(feedback ?? 0);
      setCommentText(comment ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback, comment]);

  const disabled = !messageId;

  const submit = async (rating: 'up' | 'down', commentArg?: string): Promise<void> => {
    if (!messageId) return;
    const next: FeedbackNum = rating === 'up' ? 1 : 2;
    const trimmed = commentArg ? commentArg.slice(0, MAX_COMMENT_LEN) : commentArg;
    setSaving(true);
    setCurrent(next); // optimistic
    try {
      await rateV2Message(messageId, rating, trimmed);
      onChange?.(next, trimmed ?? null);
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[AskAiRatingButtons] failed to rate:'),
        error: error,
      });
      setCurrent(feedback ?? 0); // revert
    } finally {
      setSaving(false);
    }
  };

  const isUp = current === 1;
  const isDown = current === 2;

  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      <Button
        variant='ghost'
        trackId='ask_ai_rate_up'
        type='button'
        onClick={(): void => {
          setShowComment(false);
          void submit('up');
        }}
        disabled={disabled || saving}
        title={disabled ? 'Rating available once the response is saved' : 'Helpful'}
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
          isUp ? 'text-foreground' : 'text-muted-foreground',
        )}
        data-track-category='XyneAI'
        data-track-name='LIKE_MESSAGE'
      >
        <ThumbsUp
          className='h-3.5 w-3.5'
          aria-hidden
          strokeWidth={1.75}
          fill={isUp ? 'currentColor' : 'none'}
          fillOpacity={isUp ? 0.3 : 1}
        />
      </Button>
      <Button
        variant='ghost'
        trackId='ask_ai_rate_down'
        type='button'
        onClick={(): void => {
          setShowComment(true);
          if (!isDown) void submit('down');
        }}
        disabled={disabled || saving}
        title={disabled ? 'Rating available once the response is saved' : 'Not helpful'}
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
          isDown ? 'text-foreground' : 'text-muted-foreground',
        )}
        data-track-category='XyneAI'
        data-track-name='DISLIKE_MESSAGE'
      >
        <ThumbsDown
          className='h-3.5 w-3.5'
          aria-hidden
          strokeWidth={1.75}
          fill={isDown ? 'currentColor' : 'none'}
          fillOpacity={isDown ? 0.3 : 1}
        />
      </Button>
      {showComment && isDown && (
        <span className='ml-1 inline-flex items-center gap-1'>
          <input
            value={commentText}
            onChange={(e): void => setCommentText(e.target.value.slice(0, MAX_COMMENT_LEN))}
            placeholder='what went wrong?'
            maxLength={MAX_COMMENT_LEN}
            autoFocus
            data-track-category='XyneAI'
            data-track-name='RATING_COMMENT_INPUT'
            className='h-6 w-44 rounded-md border border-border bg-background px-2 text-[11px] text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none'
            onKeyDown={(e): void => {
              if (e.key === 'Enter') {
                void submit('down', commentText);
                setShowComment(false);
              }
              if (e.key === 'Escape') setShowComment(false);
            }}
          />
          <Button
            variant='ghost'
            trackId='ask_ai_rate_comment_save'
            type='button'
            onClick={(): void => {
              void submit('down', commentText);
              setShowComment(false);
            }}
            disabled={saving}
            data-track-category='XyneAI'
            data-track-name='RATING_COMMENT_SAVE'
            className='rounded-md bg-secondary px-2 py-0.5 text-[11px] text-foreground transition-colors hover:bg-muted'
          >
            Save
          </Button>
        </span>
      )}
    </span>
  );
}
