import React from 'react';
import CodeViewer from '../../FileViewer/CodeViewer';
import type { BaseViewerProps } from '../../FileViewer/utils';

// Thin wrapper around the shared CodeViewer for use only in the KB file
// viewer route. The shell div supplies the full-size box the viewer expects;
// the surface itself comes from the shared viewer's own `bg-background`,
// which now matches the page.
export const KbCodeViewer: React.FC<BaseViewerProps> = props => (
  <div className='h-full w-full'>
    <CodeViewer {...props} />
  </div>
);
