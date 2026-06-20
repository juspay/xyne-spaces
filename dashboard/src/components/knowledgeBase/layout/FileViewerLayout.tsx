import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FileViewerPanel } from '../viewer/FileViewerPanel';

// Minimal layout: no sidebar, no Ask-AI plumbing, no gradient header.
// FileViewerPanel renders its own thin toolbar (back / filename / download)
// above the preview body, matching xyne-search's PdfViewer chrome.
export const FileViewerLayout: React.FC = () => {
  const navigate = useNavigate();
  const { collectionId, folderId, fileId } = useParams<{
    projectId: string;
    channelId: string;
    collectionId: string;
    folderId: string;
    fileId: string;
  }>();

  // '_' is the sentinel for collection root (no folder)
  const resolvedFolderId = folderId === '_' ? null : (folderId ?? null);

  const getBackNavigationPath = (): string => {
    if (!collectionId) {
      return '/knowledge-base';
    }
    // The listing screen lives at /knowledge-base?cl=&parent=, not under the
    // old path-param scheme. Build the search-params URL so Back returns the
    // user to the folder they came from instead of 404ing.
    const sp = new URLSearchParams();
    sp.set('cl', collectionId);
    if (resolvedFolderId) {
      sp.set('parent', resolvedFolderId);
    }
    return `/knowledge-base?${sp.toString()}`;
  };

  const handleBack = (): void => {
    void navigate(getBackNavigationPath());
  };

  return (
    <div className='flex h-full overflow-hidden'>
      <FileViewerPanel handleBackNavigation={handleBack} fileId={fileId} />
    </div>
  );
};
