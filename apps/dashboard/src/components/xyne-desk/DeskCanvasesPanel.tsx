import { ReactElement, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { queries } from '../../zero/queries';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useAuth } from '../../hooks/useAuth';
import { ChannelCanvasList } from '../Canvas/ChannelCanvasList';
import CanvasScreen from '../Canvas/CanvasScreen';
import type { Canvas, CanvasFolder } from '../Canvas/Canvas.types';

interface DeskCanvasesPanelProps {
  channelId: string;
  canvasId?: string | undefined;
  onOpen: (canvasId: string) => void;
  onBack: () => void;
}

/** The desk's canvases in place of the ticket list; an open canvas renders in the same pane. */
export const DeskCanvasesPanel = ({
  channelId,
  canvasId,
  onOpen,
  onBack,
}: DeskCanvasesPanelProps): ReactElement => {
  const { user } = useAuth();
  const [filter, setFilter] = useState<'all' | 'created_by_me' | 'shared'>('all');
  const [rows, details] = useCachedQuery(
    queries.hierarchyCanvases({ scope: 'channel', channelId, onlyArchived: false }),
  );
  const [folderRows] = useCachedQuery(queries.channelCanvasFolders({ channelId }));
  const canvases = (rows as Canvas[] | undefined) ?? [];

  return (
    <div className='flex-1 min-h-0 flex flex-col'>
      <div className='flex h-12 shrink-0 items-center gap-2 px-4 border-b border-border'>
        <button
          type='button'
          onClick={onBack}
          className='p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors'
          aria-label={canvasId ? 'Back to canvases' : 'Back to tickets'}
          data-track-category='Support'
          data-track-name='BackFromChannelCanvases'
        >
          <ArrowLeft size={16} />
        </button>
        <h2 className='text-sm font-semibold text-foreground'>Canvases</h2>
      </div>
      <div className='flex-1 min-h-0 overflow-hidden'>
        {canvasId ? (
          <CanvasScreen key={canvasId} canvasId={canvasId} />
        ) : (
          <ChannelCanvasList
            canvases={canvases}
            loading={details.type !== 'complete' && canvases.length === 0}
            folders={(folderRows as CanvasFolder[] | undefined) ?? []}
            activeFilter={filter}
            onFilterChange={setFilter}
            onSelect={(_e, canvas) => onOpen(canvas.id)}
            currentUserId={user?.id}
          />
        )}
      </div>
    </div>
  );
};
