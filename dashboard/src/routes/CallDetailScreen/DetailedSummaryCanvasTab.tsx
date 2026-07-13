import { ReactElement } from 'react';
import { ReadOnlyCanvasTab } from './ReadOnlyCanvasTab';

export function DetailedSummaryCanvasTab({ canvasId }: { canvasId: string }): ReactElement {
  return (
    <ReadOnlyCanvasTab
      canvasId={canvasId}
      loadingLabel='Loading detailed summary...'
      placeholder='Detailed summary content...'
    />
  );
}
