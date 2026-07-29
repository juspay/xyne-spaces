import { ReactElement } from 'react';
import { ReadOnlyCanvasTab } from './ReadOnlyCanvasTab';

export function PrdCanvasTab({ canvasId }: { canvasId: string }): ReactElement {
  return (
    <ReadOnlyCanvasTab
      canvasId={canvasId}
      loadingLabel='Loading PRD...'
      placeholder='PRD content...'
    />
  );
}
