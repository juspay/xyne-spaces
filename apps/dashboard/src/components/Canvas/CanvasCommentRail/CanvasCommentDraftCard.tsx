import { useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

import { useAuth } from '../../../hooks/useAuth';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { logger, Event } from '../../../utils/logger';
import { cn } from '../../../utils/classNames';
import Avatar from '../../ui/Avatar/Avatar';
import type { CanvasCommentAnchor } from '../CanvasCommentsPanel/CanvasCommentsPanel';

interface CanvasCommentDraftCardProps {
  canvasId: string;
  anchor: CanvasCommentAnchor;
  onBeforeCreate?: ((threadId: string, anchor: CanvasCommentAnchor) => boolean) | undefined;
  onCreated?: (() => void) | undefined;
  onFailed?: ((anchor: CanvasCommentAnchor) => void) | undefined;
  onCancel: () => void;
}

/**
 * The new-comment composer, rendered as a card in the rail rather than a
 * popover over the document — so composing a comment happens in the same place
 * comments live, and never covers the text being commented on.
 *
 * Focus lands in the field on mount; Enter commits, Escape discards.
 */
export function CanvasCommentDraftCard({
  canvasId,
  anchor,
  onBeforeCreate,
  onCreated,
  onFailed,
  onCancel,
}: CanvasCommentDraftCardProps): React.JSX.Element {
  const zero = useZero();
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // rAF so the card is painted before focus — avoids the browser scrolling
    // the document to an element that is still being positioned.
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const submit = (): void => {
    const text = body.trim();
    if (!text || submitting) return;

    const threadId = uuidv4();
    // Paint the highlight first; if the range is gone there is nothing to anchor to.
    if (onBeforeCreate?.(threadId, anchor) === false) {
      onFailed?.(anchor);
      return;
    }

    setSubmitting(true);
    const result = zero.mutate(
      mutators.canvasComment.createThread({
        threadId,
        commentId: uuidv4(),
        canvasId,
        blockId: anchor.blockId,
        ...(anchor.anchorText && { anchorText: anchor.anchorText }),
        body: text,
        mentionedUserIds: [],
        timestamp: Date.now(),
      }),
    );

    void result.server
      .then(outcome => {
        if (outcome.type === 'error') onFailed?.(anchor);
      })
      .catch((error: unknown) => {
        onFailed?.(anchor);
        logger.error(Event.API_CALL_FAILED, {
          reason: error,
          context: 'canvas_comment_create',
        });
      });

    setBody('');
    onCreated?.();
  };

  return (
    <div
      className='canvas-comment-card canvas-comment-card--draft pointer-events-auto overflow-hidden rounded-xl border border-border bg-card shadow-[0_10px_30px_hsl(var(--foreground)/0.12)]'
      data-canvas-comment-draft='true'
    >
      <div className='px-3 pt-3'>
        <div className='flex min-w-0 items-center gap-2'>
          <Avatar userId={user?.id ?? null} size='sm' rounded showActiveStatus={false} />
          <span className='truncate text-[13px] font-semibold text-foreground'>You</span>
        </div>
        {anchor.anchorText && (
          <div className='mt-1.5 flex min-w-0 pl-8'>
            <span className='w-[3px] shrink-0 rounded-sm bg-[#F2B43C]' />
            <span className='line-clamp-3 min-w-0 flex-1 whitespace-pre-wrap break-words pl-2 text-[12.5px] leading-[1.5] text-muted-foreground'>
              {anchor.anchorText}
            </span>
          </div>
        )}
      </div>

      <div className='mt-2.5 flex items-center gap-2 border-t border-border/70 px-3 py-2'>
        <Avatar userId={user?.id ?? null} size='sm' rounded showActiveStatus={false} />
        <input
          ref={inputRef}
          value={body}
          onChange={event => setBody(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            }
          }}
          placeholder='Comment…'
          aria-label='Write a comment'
          data-track-category='CANVAS'
          data-track-name='Canvas_Comment_Draft_Input'
          className='min-w-0 flex-1 border-none bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground'
        />
        <button
          type='button'
          onClick={submit}
          disabled={!body.trim()}
          aria-label='Post comment'
          className={cn(
            'grid size-7 shrink-0 place-items-center rounded-full text-background transition-colors',
            body.trim() ? 'bg-foreground' : 'bg-muted-foreground/40',
          )}
          data-track-category='CANVAS'
          data-track-name='Canvas_Comment_Draft_Send'
        >
          <ArrowUp className='size-3.5' />
        </button>
      </div>
    </div>
  );
}
