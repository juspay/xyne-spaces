import { ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import { CanvasEditor } from '../../components/Canvas/CanvasEditor/CanvasEditor';
import { CollaborativeCanvasEditor } from '../../components/Canvas/CollaborativeCanvasEditor/CollaborativeCanvasEditor';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import type { Canvas } from '../../components/Canvas/Canvas.types';

interface ReadOnlyCanvasTabProps {
  canvasId: string;
  loadingLabel: string;
  placeholder: string;
}

export function ReadOnlyCanvasTab({
  canvasId,
  loadingLabel,
  placeholder,
}: ReadOnlyCanvasTabProps): ReactElement {
  const [canvasData] = useCachedQuery(queries.getCanvas({ canvasId }), { enabled: !!canvasId });
  const canvas = canvasData as unknown as Canvas | undefined;

  if (!canvas) {
    return (
      <div className='flex items-center gap-2 text-sm text-muted-foreground'>
        <Loader2 className='size-4 animate-spin' />
        <span>{loadingLabel}</span>
      </div>
    );
  }

  if (canvas.isCollaborative) {
    return (
      <CollaborativeCanvasEditor
        key={canvas.id}
        canvasId={canvas.id}
        channelId={canvas.channelId || undefined}
        title={canvas.title}
        editable={false}
        placeholder={placeholder}
        className='call-detail-canvas-editor'
        autoFocus={false}
      />
    );
  }

  return (
    <CanvasEditor
      content={canvas.content}
      editable={false}
      canvasId={canvasId}
      className='call-detail-canvas-editor'
    />
  );
}
