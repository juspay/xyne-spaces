import React from 'react';
import TxtViewer from '../../FileViewer/TxtViewer';
import type { BaseViewerProps } from '../../FileViewer/utils';
import './fileViewerOverrides.css';

// KB-only wrapper. See KbCodeViewer for the rationale — same shell class
// triggers `fileViewerOverrides.css`, leaving the shared TxtViewer used
// elsewhere (chat attachments, citations) untouched.
export const KbTxtViewer: React.FC<BaseViewerProps> = props => (
  <div className='kb-file-viewer h-full w-full'>
    <TxtViewer {...props} />
  </div>
);

export default KbTxtViewer;
