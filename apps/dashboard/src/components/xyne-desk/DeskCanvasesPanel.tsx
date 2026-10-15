import { ReactElement } from 'react';
import { ArrowLeft } from 'lucide-react';
import CanvasTab from '../Canvas/CanvasTab';
import CanvasScreen from '../Canvas/CanvasScreen';

interface DeskCanvasesPanelProps {
  channelId: string;
  canvasId?: string | undefined;
  getCanvasRoute: (canvasId: string) => string;
  onBack: () => void;
}

/** The desk's canvases in place of the ticket list; an open canvas renders in the same pane.
 *  The list is the channel's own Canvas tab, so it carries every feature the tab has. */
export const DeskCanvasesPanel = ({
  channelId,
  canvasId,
  getCanvasRoute,
  onBack,
}: DeskCanvasesPanelProps): ReactElement => (
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
        <CanvasScreen
          key={canvasId}
          canvasId={canvasId}
          onBack={onBack}
          onNotFoundBack={onBack}
          notFoundBackLabel='Back to canvases'
        />
      ) : (
        <CanvasTab channelId={channelId} getCanvasRoute={getCanvasRoute} />
      )}
    </div>
  </div>
);
