import { ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import { CanvasEditor } from '../../components/Canvas/CanvasEditor/CanvasEditor';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import type { Canvas } from '../../components/Canvas/Canvas.types';

export function PrdCanvasTab({ canvasId }: { canvasId: string }): ReactElement {
  const [canvasData] = useCachedQuery(queries.getCanvas({ canvasId }), { enabled: !!canvasId });
  const canvas = canvasData as unknown as Canvas | undefined;
  if (!canvas?.content) {
    return (
      <div className='flex items-center gap-2 text-sm text-muted-foreground'>
        <Loader2 className='size-4 animate-spin' />
        <span>Loading PRD...</span>
      </div>
    );
  }
  return <CanvasEditor content={canvas.content} editable={false} canvasId={canvasId} />;
}
