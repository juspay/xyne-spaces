import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Check, MessageSquare, Send, Sparkles } from 'lucide-react';
import { cn } from '../../utils/classNames';
import { selectionSinkFor } from './annotate/selectionSink';
import {
  commentStoreFor,
  notifyCommentsChanged,
  onCommentsChanged,
  sortComments,
  type ItemComment,
} from './itemComments';
import type { WorkspaceItem } from './itemDescriptor';

const MAX_QUOTE_PREVIEW = 120;

export interface CommentsPanelProps {
  item: WorkspaceItem;
  /** Prefilled anchor, when the reader picked something before commenting. */
  draftAnchor?: { quote: string; selector?: string; line?: number; offset?: number } | null;
  onJump?: (comment: ItemComment) => void;
  focusCommentId?: string | null;
}

export function CommentsPanel({
  item,
  draftAnchor,
  onJump,
  focusCommentId,
}: CommentsPanelProps): ReactElement {
  const store = commentStoreFor(item);
  const sink = selectionSinkFor(item);
  const [comments, setComments] = useState<ItemComment[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const cards = useRef(new Map<string, HTMLDivElement>());

  const load = useCallback(() => {
    if (!store) return;
    void store
      .list(item)
      .then(rows => {
        setComments(sortComments(rows));
        setError(false);
      })
      .catch(() => setError(true));
  }, [store, item]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!focusCommentId) return;
    cards.current.get(focusCommentId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusCommentId, comments]);

  useEffect(
    () =>
      onCommentsChanged(id => {
        if (id === item.id) load();
      }),
    [item.id, load],
  );

  if (!store) {
    return (
      <div className='flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground'>
        Comments are not available for this item yet.
      </div>
    );
  }

  const submit = (): void => {
    const body = draft.trim();
    if (!body || !store.add || busy) return;
    setBusy(true);
    void store
      .add(item, { body, ...(draftAnchor ? { anchor: draftAnchor } : {}) })
      .then(() => {
        setDraft('');
        load();
        notifyCommentsChanged(item.id);
      })
      .catch(() => setError(true))
      .finally(() => setBusy(false));
  };

  const toggle = (comment: ItemComment): void => {
    if (!store.resolve) return;
    void store
      .resolve(item, comment.id, !comment.resolved)
      .then(() => {
        load();
        notifyCommentsChanged(item.id);
      })
      .catch(() => setError(true));
  };

  return (
    <div className='flex h-full min-h-0 w-72 flex-col border-l border-border bg-background'>
      <div className='flex h-9 flex-shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground'>
        <MessageSquare className='h-3.5 w-3.5' aria-hidden='true' />
        <span>
          {comments.length === 0
            ? 'No comments'
            : `${comments.filter(c => !c.resolved).length} open · ${comments.length} total`}
        </span>
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto px-2 py-2'>
        {error ? (
          <p className='px-1 py-2 text-xs text-muted-foreground'>Could not load comments.</p>
        ) : null}
        {comments.map(comment => (
          <div
            key={comment.id}
            ref={node => {
              if (node) cards.current.set(comment.id, node);
              else cards.current.delete(comment.id);
            }}
            className={cn(
              'mb-2 rounded-lg border px-2.5 py-2 text-xs',
              comment.resolved ? 'border-border bg-secondary/30 opacity-70' : 'border-border',
              comment.id === focusCommentId ? 'border-primary ring-1 ring-primary' : '',
            )}
          >
            <div className='flex items-center gap-2'>
              <span className='truncate font-medium text-foreground'>
                {comment.byAgent ? 'Xyne' : comment.author.name || 'Someone'}
              </span>
              {store.resolve ? (
                <button
                  type='button'
                  onClick={() => toggle(comment)}
                  aria-label={comment.resolved ? 'Reopen' : 'Resolve'}
                  title={comment.resolved ? 'Reopen' : 'Resolve'}
                  className='ml-auto grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                  data-track-category='Workspace'
                  data-track-name='comment-resolve'
                >
                  <Check className='h-3.5 w-3.5' />
                </button>
              ) : null}
            </div>

            {comment.anchor?.quote ? (
              <button
                type='button'
                onClick={() => onJump?.(comment)}
                className='mt-1 block w-full truncate border-l-2 border-primary/50 pl-2 text-left italic text-muted-foreground hover:text-foreground'
                data-track-category='Workspace'
                data-track-name='comment-jump'
              >
                {comment.anchor.quote.slice(0, MAX_QUOTE_PREVIEW)}
              </button>
            ) : null}

            <p className='mt-1 whitespace-pre-wrap text-foreground'>{comment.body}</p>
          </div>
        ))}
      </div>

      {store.add ? (
        <div className='flex-shrink-0 border-t border-border p-2'>
          {draftAnchor?.quote ? (
            <p className='mb-1 truncate border-l-2 border-primary/50 pl-2 text-[11px] italic text-muted-foreground'>
              {draftAnchor.quote.slice(0, MAX_QUOTE_PREVIEW)}
            </p>
          ) : null}
          <textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
            }}
            rows={2}
            placeholder={
              draftAnchor?.quote && sink ? 'Comment, or ask Xyne about this' : 'Leave a comment'
            }
            data-track-category='Workspace'
            data-track-name='comment-draft'
            className='w-full resize-none rounded-md border border-border bg-transparent px-2 py-1.5 text-xs text-foreground outline-none focus:border-ring'
          />
          <div className='mt-1.5 flex items-center justify-end gap-1.5'>
            {sink && draftAnchor?.quote ? (
              <button
                type='button'
                onClick={() => {
                  sink.send({
                    text: draftAnchor.quote,
                    url: item.url ?? '',
                    title: item.title,
                    ...(item.provider ? { provider: item.provider } : {}),
                    intent: 'ask',
                    ...(draft.trim() ? { question: draft.trim() } : {}),
                  });
                  setDraft('');
                }}
                title='Send this passage to the Xyne chat'
                className='flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-secondary/60'
                data-track-category='Workspace'
                data-track-name='comment-ask-xyne'
              >
                <Sparkles className='h-3 w-3' aria-hidden='true' />
                Ask Xyne
              </button>
            ) : null}
            <button
              type='button'
              onClick={submit}
              disabled={!draft.trim() || busy}
              className='flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-40'
              data-track-category='Workspace'
              data-track-name='comment-add'
            >
              <Send className='h-3 w-3' aria-hidden='true' />
              Comment
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
