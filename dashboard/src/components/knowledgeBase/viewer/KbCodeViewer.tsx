import React from 'react';
import CodeViewer from '../../FileViewer/CodeViewer';
import type { BaseViewerProps } from '../../FileViewer/utils';
import './fileViewerOverrides.css';

// Thin wrapper around the shared CodeViewer for use only in the KB file
// viewer route. The wrapping <div> applies `.kb-file-viewer` so the
// scoped CSS in `fileViewerOverrides.css` repaints the inner surfaces
// onto the cream / midnight page bg (`ai-page-bg`). Chat attachments and
// citation modals don't get this class, so they're unaffected.
export const KbCodeViewer: React.FC<BaseViewerProps> = props => (
  <div className='kb-file-viewer h-full w-full'>
    <CodeViewer {...props} />
  </div>
);
