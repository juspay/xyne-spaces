import { useMemo, useRef, useState } from 'react';
import { ArrowUp, Check, RotateCcw } from 'lucide-react';
import { CanvasCommentThreadStatus } from '@xyne/shared';

import { useAuth } from '../../../hooks/useAuth';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useUsers } from '../../../hooks/useUsers';
import { queries } from '../../../zero/queries';
import { cn } from '../../../utils/classNames';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import Avatar from '../../ui/Avatar/Avatar';
import { formatRelativeCommentTime } from '../canvasCommentTime';
import type { CanvasCommentHighlightThread } from '../useCanvasCommentHighlights';

type UserLite = { id: string; name?: string; displayName?: string | null; email?: string };

export type RailComment = {
  id: string;
  threadId: string;
  body: string;
  isInitial?: boolean;
  createdBy: string;
  deletedAt?: number | null;
  editedAt?: number | null;
  createdAt: number;
  createdByUser?: UserLite | null;
};

interface CanvasCommentCardProps {
  thread: CanvasCommentHighlightThread;
  isActive: boolean;
  editable: boolean;
  onSelect: () => void;
  onResolveToggle: () => void;
  onReply: (body: string) => void;
}

const getDisplayName = (user?: UserLite | null): string =>
  user ? getUserDisplayName(user) : 'Unknown user';

/**
 * One thread, rendered as a card that parks beside its anchored text.
 * Collapsed by default to the initial comment plus a reply count; opening the
 * card reveals the full transcript and the reply composer.
 */
export function CanvasCommentCard({
  thread,
  isActive,
  editable,
  onSelect,
  onResolveToggle,
  onReply,
}: CanvasCommentCardProps): React.JSX.Element {
  const { user } = useAuth();
  const allUsers = useUsers();
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Only the open card pays for its transcript. Collapsed cards render from the
  // thread row alone, so a canvas with 40 threads holds 1 comment query, not 40.
  const [loaded = []] = useCachedQuery(queries.canvasThreadComments({ threadId: thread.id }), {
    enabled: isActive,
  }) as unknown as [RailComment[]];

  // The thread row already carries its initial comment, so a collapsed card
  // renders its preview with no query of its own — only the open card fetches
  // the full transcript.
  const fallbackInitial: RailComment | undefined = thread.initialComment
    ? { ...thread.initialComment, threadId: thread.id, isInitial: true }
    : undefined;

  const comments = useMemo(() => {
    const initial =
      loaded.find(c => c.isInitial || c.id === thread.initialCommentId) ?? fallbackInitial;
    const replies = loaded.filter(
      c => c.id !== initial?.id && !c.isInitial && c.id !== thread.initialCommentId,
    );
    return [initial, ...replies].filter(Boolean) as RailComment[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, thread.initialCommentId, thread.initialComment?.id, thread.id]);

  const replyCount = Math.max((thread.commentCount ?? 1) - 1, 0);
  const isResolved = thread.status === CanvasCommentThreadStatus.RESOLVED;

  const authorOf = (comment: RailComment): UserLite | null | undefined =>
    allUsers.find(candidate => candidate.id === comment.createdBy) ?? comment.createdByUser;

  const submit = (): void => {
    const body = draft.trim();
    if (!body) return;
    onReply(body);
    setDraft('');
  };

  const preview = comments[0];

  return (
    <div
      role='button'
      tabIndex={isActive ? -1 : 0}
      aria-expanded={isActive}
      aria-label={`Comment thread on “${thread.anchorText ?? 'selected text'}”`}
      onClick={onSelect}
      onKeyDown={event => {
        if (isActive) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      data-canvas-comment-card={thread.id}
      data-track-category='CANVAS'
      data-track-name='Canvas_Comment_Card_Open'
      className={cn(
        'canvas-comment-card pointer-events-auto cursor-default overflow-hidden rounded-xl border bg-card text-left',
        isActive
          ? 'border-border shadow-[0_10px_30px_hsl(var(--foreground)/0.12)]'
          : 'border-border/70 shadow-[0_1px_2px_hsl(var(--foreground)/0.05)] hover:border-border',
        isResolved && 'bg-muted/40',
      )}
    >
      <div className='px-3 pt-3'>
        {(isActive ? comments : [preview]).filter(Boolean).map((comment, index) => {
          const c = comment as RailComment;
          const isFirst = index === 0;
          const author = authorOf(c);
          const isDeleted = Boolean(c.deletedAt);
          return (
            <div key={c.id} className={cn('mb-3', !isFirst && 'mt-1')}>
              <div className='flex min-w-0 items-center gap-2'>
                <Avatar userId={c.createdBy} size='sm' rounded showActiveStatus={false} />
                <span className='truncate text-[13px] font-semibold text-foreground'>
                  {c.createdBy === user?.id ? 'You' : getDisplayName(author)}
                </span>
                <span className='shrink-0 text-[11.5px] text-muted-foreground'>
                  {formatRelativeCommentTime(c.createdAt)}
                </span>
                <span className='flex-1' />
                {isFirst && editable && (
                  <button
                    type='button'
                    aria-label={isResolved ? 'Reopen comment' : 'Resolve comment'}
                    title={isResolved ? 'Reopen' : 'Resolve'}
                    onClick={event => {
                      event.stopPropagation();
                      onResolveToggle();
                    }}
                    className='canvas-comment-card__action grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground'
                    data-track-category='CANVAS'
                    data-track-name='Canvas_Comment_Resolve_Toggle'
                  >
                    {isResolved ? <RotateCcw className='size-3.5' /> : <Check className='size-4' />}
                  </button>
                )}
              </div>

              {isFirst && thread.anchorText && (
                <div className='mt-1.5 flex min-w-0 pl-8'>
                  <span className='w-[3px] shrink-0 rounded-sm bg-[#F2B43C]' />
                  <span className='min-w-0 flex-1 whitespace-pre-wrap break-words pl-2 text-[12.5px] leading-[1.5] text-muted-foreground'>
                    {thread.anchorText}
                  </span>
                </div>
              )}

              <p
                className={cn(
                  'mt-1 whitespace-pre-wrap break-words pl-8 text-[13.5px] leading-[1.55] text-foreground',
                  isDeleted && 'italic text-muted-foreground',
                  !isActive && 'line-clamp-4',
                )}
              >
                {isDeleted ? 'Comment deleted' : c.body}
              </p>
            </div>
          );
        })}

        {!isActive && replyCount > 0 && (
          <button
            type='button'
            onClick={onSelect}
            className='mb-3 pl-8 text-[12px] font-medium text-muted-foreground hover:text-foreground'
            data-track-category='CANVAS'
            data-track-name='Canvas_Comment_Expand'
          >
            {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
          </button>
        )}
      </div>

      {editable && (
        <div className='flex items-center gap-2 border-t border-border/70 px-3 py-2'>
          <Avatar userId={user?.id ?? null} size='sm' rounded showActiveStatus={false} />
          <input
            ref={inputRef}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder='Reply…'
            aria-label='Reply to comment'
            data-track-category='CANVAS'
            data-track-name='Canvas_Comment_Reply_Input'
            className='min-w-0 flex-1 border-none bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground'
          />
          <button
            type='button'
            onClick={event => {
              event.stopPropagation();
              submit();
            }}
            disabled={!draft.trim()}
            aria-label='Send reply'
            className={cn(
              'grid size-7 shrink-0 place-items-center rounded-full text-background transition-colors',
              draft.trim() ? 'bg-foreground' : 'bg-muted-foreground/40',
            )}
            data-track-category='CANVAS'
            data-track-name='Canvas_Comment_Reply_Send'
          >
            <ArrowUp className='size-3.5' />
          </button>
        </div>
      )}
    </div>
  );
}
