import { type ReactElement } from 'react';
import { ChevronLeft, FileText, Loader2 } from 'lucide-react';
import { CollaborativeCanvasEditor } from '../../../components/Canvas/CollaborativeCanvasEditor/CollaborativeCanvasEditor';
import { Tooltip } from '../../../components/ui/Tooltip';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import type { Canvas } from '../../../components/Canvas/Canvas.types';

export interface DetailedSummaryPanelProps {
  canvasId: string;
  onClose: () => void;
}

export function DetailedSummaryPanel({
  canvasId,
  onClose,
}: DetailedSummaryPanelProps): ReactElement {
  const [canvasData] = useCachedQuery(queries.getCanvas({ canvasId }), {
    enabled: !!canvasId,
  });
  const canvas = canvasData as unknown as Canvas | undefined;

  return (
    <aside
      aria-label='Detailed summary'
      className='absolute inset-y-0 right-0 z-30 flex w-full flex-col overflow-hidden border-l border-border/70 bg-background shadow-2xl md:w-[640px]'
    >
      <header className='flex shrink-0 items-center gap-3 border-b border-border/70 px-5 py-3.5'>
        <Tooltip content='Close detailed summary' side='bottom'>
          <button
            type='button'
            onClick={onClose}
            className='inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            aria-label='Close detailed summary'
            data-track-category='RecordingDetailV2'
            data-track-name='close_detailed_summary'
          >
            <ChevronLeft className='size-4' aria-hidden='true' />
          </button>
        </Tooltip>
        <div className='flex min-w-0 items-center gap-2'>
          <FileText className='size-4 shrink-0 text-muted-foreground' aria-hidden='true' />
          <h2 className='truncate text-base font-semibold text-foreground'>Detailed summary</h2>
        </div>
      </header>

      <div className='min-h-0 flex-1'>
        {!canvas ? (
          <div className='flex h-full items-center justify-center gap-2 text-sm text-muted-foreground'>
            <Loader2 className='size-4 animate-spin' aria-hidden='true' />
            Loading detailed summary
          </div>
        ) : (
          <CollaborativeCanvasEditor
            key={canvas.id}
            canvasId={canvas.id}
            channelId={canvas.channelId || undefined}
            title={canvas.title}
            editable={false}
            placeholder='Detailed summary'
            className='detailed-summary-canvas-editor h-full'
            autoFocus={false}
          />
        )}
      </div>
    </aside>
  );
}
