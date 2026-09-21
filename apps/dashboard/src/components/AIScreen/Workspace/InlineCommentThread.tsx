import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { Check, Send, X } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import {
  commentStoreFor,
  notifyCommentsChanged,
  onCommentsChanged,
  sortComments,
  type ItemComment,
  type WorkspaceItem,
} from '../../workspaceItems';

const CARD_WIDTH = 320;

export interface InlineCommentTarget {
  commentId: string;
  rect: { top: number; left: number; width: number; height: number };
}

export interface InlineCommentThreadProps {
  item: WorkspaceItem;
  target: InlineCommentTarget;
  onClose: () => void;
}

function anchorKey(comment: ItemComment | undefined): string {
  if (!comment?.anchor) return '';
  return comment.anchor.selector || comment.anchor.quote || '';
}

export function InlineCommentThread({
  item,
  target,
  onClose,
}: InlineCommentThreadProps): ReactElement | null {
  const store = commentStoreFor(item);
  const [thread, setThread] = useState<ItemComment[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const card = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);

  const load = useCallback((): void => {
    if (!store) return;
    void store
      .list(item)
      .then(rows => {
        const clicked = rows.find(row => row.id === target.commentId);
        if (!clicked) {
          setThread([]);
          return;
        }
        const key = anchorKey(clicked);
        const same = rows.filter(row => anchorKey(row) === key && !row.resolved);
        setThread(sortComments(same.length > 0 ? same : [clicked]));
      })
      .catch(() => setThread([]));
  }, [store, item, target.commentId]);

  useEffect(load, [load]);

  useLayoutEffect(() => {
    const node = card.current;
    if (!node) return;
    const parent = (node.offsetParent as HTMLElement | null) ?? node.parentElement;
    if (!parent) return;
    const room = parent.clientWidth;
    const gap = 12;
    const edge = 8;

    let left = target.rect.left + target.rect.width + gap;
    if (left + CARD_WIDTH > room - edge) {
      const flipped = target.rect.left - CARD_WIDTH - gap;
      left = flipped >= edge ? flipped : Math.max(edge, room - CARD_WIDTH - edge);
    }

    const height = node.offsetHeight;
    const top = Math.max(edge, Math.min(target.rect.top, parent.clientHeight - height - edge));
    setPlace({ top, left });
  }, [target, thread.length]);

  useEffect(
    () =>
      onCommentsChanged(id => {
        if (id === item.id) load();
      }),
    [item.id, load],
  );

  if (!store || thread.length === 0) return null;

  const reply = (): void => {
    const body = draft.trim();
    const anchor = thread[0]?.anchor;
    if (!body || !store.add || busy) return;
    setBusy(true);
    void store
      .add(item, { body, ...(anchor ? { anchor } : {}) })
      .then(() => {
        setDraft('');
        notifyCommentsChanged(item.id);
      })
      .finally(() => setBusy(false));
  };

  const resolve = (comment: ItemComment): void => {
    if (!store.resolve) return;
    void store.resolve(item, comment.id, true).then(() => {
      notifyCommentsChanged(item.id);
      onClose();
    });
  };

  return (
    <div
      className='absolute z-20 rounded-lg border border-border bg-popover shadow-xl'
      ref={card}
      style={{
        width: CARD_WIDTH,
        top: place?.top ?? Math.max(8, target.rect.top),
        left: place?.left ?? Math.max(8, target.rect.left),
      }}
    >
      <div className='flex items-center gap-2 border-b border-border px-3 py-1.5'>
        <span className='text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
          {thread.length === 1 ? 'Comment' : `${thread.length} comments`}
        </span>
        <button
          type='button'
          onClick={onClose}
          aria-label='Close'
          className='ml-auto grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
          data-track-category='AskAI'
          data-track-name='inline-comment-close'
        >
          <X className='h-3 w-3' />
        </button>
      </div>

      <div className='max-h-64 overflow-y-auto px-3 py-2'>
        {thread.map((comment, index) => (
          <div key={comment.id} className={cn('text-xs', index > 0 && 'mt-2.5')}>
            <div className='flex items-center gap-2'>
              <span className='truncate font-medium text-foreground'>
                {comment.byAgent ? 'Xyne' : comment.author.name || 'Someone'}
              </span>
              {index === 0 && store.resolve ? (
                <button
                  type='button'
                  onClick={() => resolve(comment)}
                  title='Resolve'
                  aria-label='Resolve'
                  className='ml-auto grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                  data-track-category='AskAI'
                  data-track-name='inline-comment-resolve'
                >
                  <Check className='h-3.5 w-3.5' />
                </button>
              ) : null}
            </div>
            <p className='mt-0.5 whitespace-pre-wrap text-foreground'>{comment.body}</p>
          </div>
        ))}
      </div>

      {store.add ? (
        <div className='flex items-end gap-1 border-t border-border p-2'>
          <textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                reply();
              }
              if (event.key === 'Escape') onClose();
            }}
            rows={1}
            placeholder='Reply'
            autoFocus
            data-track-category='AskAI'
            data-track-name='inline-comment-reply-draft'
            className='min-h-0 flex-1 resize-none rounded-md border border-border bg-transparent px-2 py-1.5 text-xs text-foreground outline-none focus:border-ring'
          />
          <button
            type='button'
            onClick={reply}
            disabled={!draft.trim() || busy}
            aria-label='Reply'
            className='grid h-7 w-7 flex-shrink-0 place-items-center rounded-md bg-primary text-primary-foreground disabled:opacity-40'
            data-track-category='AskAI'
            data-track-name='inline-comment-reply'
          >
            <Send className='h-3.5 w-3.5' />
          </button>
        </div>
      ) : null}
    </div>
  );
}
