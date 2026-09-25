import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Pencil, Pin, PinOff } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { formatRelativeTime } from '../../../utils/dateUtils';
import type {
  ConversationArtifact,
  ConversationArtifactPatch,
} from '../../../services/XyneAI/XyneAIArtifactsService';
import { artifactKindIcon, artifactKindLabel } from './artifactKinds';

interface ArtifactRowProps {
  artifact: ConversationArtifact;
  onOpen: (artifact: ConversationArtifact) => void;
  onPatch: (artifactId: string, patch: ConversationArtifactPatch) => void;
}

function ArtifactRow({ artifact, onOpen, onPatch }: ArtifactRowProps): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(artifact.title);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const stale = artifact.status === 'STALE';

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = (): void => {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === artifact.title) {
      setDraft(artifact.title);
      return;
    }
    onPatch(artifact.id, { title: next });
  };

  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-secondary/60',
        stale && 'opacity-50',
      )}
    >
      <span className='grid h-7 w-7 flex-shrink-0 place-items-center rounded-md bg-muted text-muted-foreground'>
        {artifactKindIcon(artifact.kind, 'h-3.5 w-3.5')}
      </span>

      <div className='flex min-w-0 flex-1 flex-col items-start'>
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            aria-label={`Rename ${artifact.title}`}
            onChange={event => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commit();
              }
              if (event.key === 'Escape') {
                setDraft(artifact.title);
                setEditing(false);
              }
            }}
            className='w-full rounded border border-border bg-background px-1 py-0.5 text-[13px] text-foreground outline-none'
            data-track-category='AskAI'
            data-track-name='workspace-artifact-rename-input'
          />
        ) : (
          <button
            type='button'
            onClick={() => onOpen(artifact)}
            onDoubleClick={() => {
              setDraft(artifact.title);
              setEditing(true);
            }}
            className='w-full truncate text-left text-[13px] font-medium text-foreground'
            title={artifact.title}
            data-track-category='AskAI'
            data-track-name='workspace-artifact-open'
          >
            {artifact.title}
          </button>
        )}
        <span className='flex items-center gap-1.5 text-[11px] text-muted-foreground'>
          <span>{artifactKindLabel(artifact.kind)}</span>
          <span aria-hidden='true'>·</span>
          <span>{formatRelativeTime(new Date(artifact.updatedAt))}</span>
          {stale && (
            <>
              <span aria-hidden='true'>·</span>
              <span>stale</span>
            </>
          )}
        </span>
      </div>

      <button
        type='button'
        aria-label={artifact.pinned ? `Unpin ${artifact.title}` : `Pin ${artifact.title}`}
        title={artifact.pinned ? 'Unpin' : 'Pin'}
        onClick={() => onPatch(artifact.id, { pinned: !artifact.pinned })}
        className={cn(
          'grid h-7 w-7 flex-shrink-0 place-items-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground',
          !artifact.pinned && 'opacity-0 group-hover:opacity-100 focus:opacity-100',
        )}
        data-track-category='AskAI'
        data-track-name='workspace-artifact-pin'
      >
        {artifact.pinned ? <Pin className='h-3.5 w-3.5' /> : <PinOff className='h-3.5 w-3.5' />}
      </button>

      <button
        type='button'
        aria-label={`Rename ${artifact.title}`}
        title='Rename'
        onClick={() => {
          setDraft(artifact.title);
          setEditing(true);
        }}
        className='grid h-7 w-7 flex-shrink-0 place-items-center rounded text-muted-foreground opacity-0 hover:bg-foreground/10 hover:text-foreground focus:opacity-100 group-hover:opacity-100'
        data-track-category='AskAI'
        data-track-name='workspace-artifact-rename'
      >
        <Pencil className='h-3.5 w-3.5' />
      </button>
    </div>
  );
}

interface ArtifactListProps {
  artifacts: ConversationArtifact[];
  isLoading: boolean;
  isError: boolean;
  emptyTitle: string;
  emptyBody: string;
  onOpen: (artifact: ConversationArtifact) => void;
  onPatch: (artifactId: string, patch: ConversationArtifactPatch) => void;
}

export function ArtifactList({
  artifacts,
  isLoading,
  isError,
  emptyTitle,
  emptyBody,
  onOpen,
  onPatch,
}: ArtifactListProps): ReactElement {
  if (isLoading) {
    return (
      <div className='flex h-full items-center justify-center'>
        <div className='h-6 w-6 animate-spin rounded-full border-b-2 border-ring' />
      </div>
    );
  }

  if (isError) {
    return (
      <div className='flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground'>
        Could not load artifacts for this conversation.
      </div>
    );
  }

  if (artifacts.length === 0) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-1 px-8 text-center'>
        <p className='text-sm font-medium text-foreground'>{emptyTitle}</p>
        <p className='text-xs text-muted-foreground'>{emptyBody}</p>
      </div>
    );
  }

  const pinned = artifacts.filter(a => a.pinned);
  const rest = artifacts.filter(a => !a.pinned);

  return (
    <div className='h-full overflow-y-auto px-2 py-2'>
      {pinned.length > 0 && (
        <>
          <p className='px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
            Pinned
          </p>
          {pinned.map(artifact => (
            <ArtifactRow key={artifact.id} artifact={artifact} onOpen={onOpen} onPatch={onPatch} />
          ))}
          {rest.length > 0 && (
            <p className='px-2 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
              All
            </p>
          )}
        </>
      )}
      {rest.map(artifact => (
        <ArtifactRow key={artifact.id} artifact={artifact} onOpen={onOpen} onPatch={onPatch} />
      ))}
    </div>
  );
}
