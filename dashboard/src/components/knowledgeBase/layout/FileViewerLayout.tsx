import React, { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FileViewerPanel } from '../viewer/FileViewerPanel';
import { xyneAIActor } from '../../../machines/xyneAIMachine';
import {
  useProjectCollections,
  setProjectId,
  setChannelId,
  setActiveCollection,
  setCurrentFolderId,
} from '../hooks/useProjectCollections';

// Minimal layout above FileViewerPanel's thin toolbar. The toolbar exposes an
// Ask-AI affordance that opens XyneAI scoped to this single file (kbDocId is
// the Vespa fileId, not the route cuid).
export const FileViewerLayout: React.FC = () => {
  const navigate = useNavigate();
  const { projectId, channelId, collectionId, folderId, fileId } = useParams<{
    projectId: string;
    channelId: string;
    collectionId: string;
    folderId: string;
    fileId: string;
  }>();

  // '_' is the sentinel for collection root (no folder)
  const resolvedFolderId = folderId === '_' ? null : (folderId ?? null);

  // URL → machine sync. When a user arrives here through the collection
  // browser, KnowledgeBaseV2Screen has already seeded the XState context
  // (`setActiveCollection`, `setCurrentFolderId`) so the tree-data subscription
  // has populated `nodes` and FileViewerPanel resolves `nodes[fileId]`
  // immediately. Deep-link arrivals (e.g. clicking a citation chip in Ask AI)
  // skip that screen — without this seed the machine has no active collection,
  // the tree never loads, and the viewer renders "No file selected".
  const {
    activeCollection,
    currentFolderId,
    projectId: machineProjectId,
    channelId: machineChannelId,
  } = useProjectCollections();

  useEffect(() => {
    if (projectId && machineProjectId !== projectId) setProjectId(projectId);
  }, [projectId, machineProjectId]);

  useEffect(() => {
    if (channelId && machineChannelId !== channelId) setChannelId(channelId);
  }, [channelId, machineChannelId]);

  useEffect(() => {
    if (collectionId && activeCollection?.id !== collectionId) {
      setActiveCollection({ id: collectionId });
    }
  }, [collectionId, activeCollection?.id]);

  useEffect(() => {
    if (resolvedFolderId !== currentFolderId) setCurrentFolderId(resolvedFolderId);
  }, [resolvedFolderId, currentFolderId]);

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

  const handleOpenChat = (docId: string, docName: string): void => {
    const kbContext = {
      projectId: projectId || 'default',
      collectionId: collectionId || undefined,
      parentDocId: resolvedFolderId || undefined,
      docId,
    };
    sessionStorage.setItem('kb_xyne_ai_context', JSON.stringify(kbContext));

    xyneAIActor.send({
      type: 'OPEN',
      startFreshChat: true,
      kbCollectionId: collectionId ?? null,
      kbChannelId: channelId ?? null,
      kbDocId: docId,
      kbDocName: docName,
    });
  };

  return (
    <div className='flex h-full overflow-hidden'>
      <FileViewerPanel
        handleBackNavigation={handleBack}
        fileId={fileId}
        onOpenChat={handleOpenChat}
      />
    </div>
  );
};
