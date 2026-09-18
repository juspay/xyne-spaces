import { useState, type ReactElement } from 'react';
import { MessageSquarePlus, Send, X } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { commentStoreFor, notifyCommentsChanged } from '../itemComments';
import type { WorkspaceItem } from '../itemDescriptor';
import { selectionSinkFor } from './selectionSink';
import type { PickedBlock } from './transport';

const BOX_WIDTH = 340;
const PREVIEW_CHARS = 140;

export interface AnnotationParts {
  toggle: ReactElement;
  box: ReactElement | null;
}

export interface AnnotationInput {
  item: WorkspaceItem;
  editable: boolean;
  url: string;
  picking: boolean;
  picked: PickedBlock | null;
  start: () => void;
  stop: () => void;
  onCleared: () => void;
}

export function useAnnotation({
  item,
  editable,
  url,
  picking,
  picked,
  start,
  stop,
  onCleared,
}: AnnotationInput): AnnotationParts {
  const sink = selectionSinkFor(item);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const store = commentStoreFor(item);
  const canComment = !!store?.add;

  const clear = (): void => {
    setDraft('');
    setSaved(false);
    onCleared();
  };

  const comment = (): void => {
    const body = draft.trim();
    if (!body || !picked || !store?.add || saving) return;
    setSaving(true);
    void store
      .add(item, {
        body,
        anchor: { quote: picked.text.slice(0, 2000), selector: picked.selector },
      })
      .then(() => {
        setSaved(true);
        setDraft('');
        notifyCommentsChanged(item.id);
      })
      .catch(() => setSaved(false))
      .finally(() => setSaving(false));
  };

  const ask = (): void => {
    if (!picked || !sink) return;
    sink.send({
      text: picked.text,
      url,
      title: item.title,
      ...(item.provider ? { provider: item.provider } : {}),
      intent: editable ? 'edit' : 'ask',
      ...(draft.trim() ? { question: draft.trim() } : {}),
    });
    clear();
  };

  // Icon only: this sits in a tab strip that is already competing for room, and
  // the label is the first thing to cost a tab its title.
  const toggle = (
    <button
      type='button'
      onClick={picking ? stop : start}
      aria-label={picking ? 'Stop picking' : 'Annotate'}
      aria-pressed={picking}
      className={cn(
        'grid size-7 flex-shrink-0 place-items-center self-center rounded-md',
        picking
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground',
      )}
      title={
        picking
          ? 'Pick a block — click a paragraph, list or card'
          : 'Annotate: point at part of this page to comment on it or ask about it'
      }
      data-track-category='AskAI'
      data-track-name='workspace-page-annotate'
    >
      <MessageSquarePlus className='size-4' aria-hidden='true' />
    </button>
  );

  const box = picked ? (
    <div
      className='absolute z-10 rounded-lg border border-primary/60 bg-background p-2 shadow-lg'
      style={{
        width: BOX_WIDTH,
        top: Math.max(8, picked.rect.top + picked.rect.height + 6),
        left: Math.max(8, picked.rect.left),
      }}
    >
      <div className='flex items-start gap-2'>
        <p
          className='min-w-0 flex-1 truncate text-[11px] italic text-muted-foreground'
          title={picked.text}
        >
          {picked.text.slice(0, PREVIEW_CHARS)}
        </p>
        <button
          type='button'
          onClick={clear}
          aria-label='Cancel'
          className='grid h-5 w-5 flex-shrink-0 place-items-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
          data-track-category='AskAI'
          data-track-name='workspace-page-annotate-cancel'
        >
          <X className='h-3 w-3' />
        </button>
      </div>

      <textarea
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) comment();
          if (event.key === 'Escape') clear();
        }}
        rows={2}
        placeholder={canComment ? 'Comment, or ask Xyne about this' : 'Ask Xyne about this'}
        autoFocus
        data-track-category='AskAI'
        data-track-name='workspace-page-annotate-draft'
        className='mt-1.5 w-full resize-none rounded-md border border-border bg-transparent px-2 py-1.5 text-xs text-foreground outline-none focus:border-ring'
      />

      <div className='mt-1.5 flex items-center gap-1.5'>
        {canComment ? (
          <button
            type='button'
            onClick={comment}
            disabled={!draft.trim() || saving}
            className='flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-40'
            data-track-category='AskAI'
            data-track-name='workspace-page-annotate-comment'
          >
            <Send className='h-3 w-3' />
            Comment
          </button>
        ) : null}
        {sink ? (
          <button
            type='button'
            onClick={ask}
            className='rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-secondary/60'
            data-track-category='AskAI'
            data-track-name='workspace-page-annotate-ask'
          >
            {draft.trim()
              ? editable
                ? 'Send edit to Xyne chat'
                : 'Send question to Xyne chat'
              : editable
                ? 'Edit with Xyne'
                : 'Ask with Xyne'}
          </button>
        ) : null}
        {saved ? <span className='text-[11px] text-muted-foreground'>Saved</span> : null}
        <button
          type='button'
          onClick={() => {
            clear();
            start();
          }}
          className='ml-auto rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
          data-track-category='AskAI'
          data-track-name='workspace-page-annotate-again'
        >
          Pick another
        </button>
      </div>
    </div>
  ) : null;

  return { toggle, box };
}
