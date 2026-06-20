import React from 'react';
import PdfViewer from '../../FileViewer/PdfViewer';
import type { BaseViewerProps } from '../../FileViewer/utils';
import './fileViewerOverrides.css';

// KB-only wrapper. See KbCodeViewer for the rationale.
export const KbPdfViewer: React.FC<BaseViewerProps> = props => (
  <div className='kb-file-viewer h-full w-full'>
    <PdfViewer {...props} />
  </div>
);

export default KbPdfViewer;
