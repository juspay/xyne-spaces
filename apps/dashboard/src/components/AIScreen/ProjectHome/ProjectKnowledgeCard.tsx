import { useState, type ReactElement } from 'react';
import { toast } from 'sonner';
import { FolderRemove } from '@xyne/icons';
import { useV2ChatProjectKnowledge } from '../../../hooks/useAskAISessionsV2';
import type { ChatProjectKnowledge } from '../../../services/XyneAI/XyneAISessionsV2Service';
import {
  SECTION_HEADING_CLASS,
  formatKnowledgeMime,
  formatKnowledgeSize,
  knowledgeTypeLabel,
} from './projectHome.utils';

function Badge({ children }: { children: string }): ReactElement {
  return (
    <span className='rounded-full bg-secondary/60 px-2 py-0.5 text-[11px] text-muted-foreground'>
      {children}
    </span>
  );
}

function KnowledgeRow({
  item,
  onDetach,
}: {
  item: ChatProjectKnowledge;
  onDetach: (item: ChatProjectKnowledge) => void;
}): ReactElement {
  const size = formatKnowledgeSize(item.size);
  const mime = formatKnowledgeMime(item.mimeType);
  return (
    <li className='group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-secondary/40'>
      <div className='min-w-0 flex-1'>
        <p className='truncate text-sm text-foreground'>{item.title}</p>
        <div className='mt-1 flex flex-wrap items-center gap-1.5'>
          <Badge>{knowledgeTypeLabel(item.type)}</Badge>
          {mime && <Badge>{mime}</Badge>}
          {size && <Badge>{size}</Badge>}
        </div>
      </div>
      <button
        type='button'
        onClick={() => onDetach(item)}
        aria-label={`Remove ${item.title} from this project`}
        title='Remove from project'
        className='grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100'
        data-track-category='XyneAI'
        data-track-name='DETACH_PROJECT_KNOWLEDGE'
      >
        <FolderRemove size={15} aria-hidden />
      </button>
    </li>
  );
}

export function ProjectKnowledgeCard({ projectId }: { projectId: string }): ReactElement {
  const { knowledge, isLoading, isError, detach } = useV2ChatProjectKnowledge(projectId);
  const [busyId, setBusyId] = useState<string | null>(null);

  const onDetach = (item: ChatProjectKnowledge): void => {
    if (busyId) return;
    setBusyId(item.id);
    void (async () => {
      try {
        await detach(item.id);
      } catch {
        toast.error(`Could not remove ${item.title}`);
      } finally {
        setBusyId(null);
      }
    })();
  };

  return (
    <section>
      <h2 className={SECTION_HEADING_CLASS}>Knowledge</h2>

      {isLoading ? (
        <p className='mt-3 text-xs text-muted-foreground'>Loading…</p>
      ) : isError ? (
        <p className='mt-3 text-xs text-muted-foreground'>
          Could not load this project&rsquo;s knowledge. Refresh to try again.
        </p>
      ) : knowledge.length === 0 ? (
        <p className='mt-3 text-xs text-muted-foreground'>
          Nothing attached yet. Files and Spaces items added to this project are available to every
          chat in it.
        </p>
      ) : (
        <ul className='mt-2 -mx-2'>
          {knowledge.map(item => (
            <KnowledgeRow key={item.id} item={item} onDetach={onDetach} />
          ))}
        </ul>
      )}
    </section>
  );
}
