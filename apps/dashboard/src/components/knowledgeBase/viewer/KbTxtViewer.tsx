import React from 'react';
import TxtViewer from '../../FileViewer/TxtViewer';
import type { BaseViewerProps } from '../../FileViewer/utils';

// KB-only wrapper. See KbCodeViewer for the rationale — the shell div only
// supplies the full-size box; the surface comes from the shared TxtViewer.
export const KbTxtViewer: React.FC<BaseViewerProps> = props => (
  <div className='h-full w-full'>
    <TxtViewer {...props} />
  </div>
);
