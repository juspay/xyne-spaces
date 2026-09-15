import React, { useEffect } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FileViewerPanel } from '../viewer/FileViewerPanel';
import { resolveKbBasePath } from '../../knowledgeBaseV2/utils/kbRoutePaths';
import { xyneAIActor } from '../../../machines/xyneAIMachine';
import {
  useProjectCollections,
  setProjectId,
  setChannelId,
  setActiveCollection,
  setCurrentFolderId,
  setCurrentFileId,
} from '../hooks/useProjectCollections';

// Minimal layout above FileViewerPanel's thin toolbar. The toolbar exposes an
// Ask-AI affordance that opens XyneAI scoped to this single file (kbDocId is
// the Vespa fileId, not the route cuid).
export const FileViewerLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId, channelId, collectionId, folderId, fileId } = useParams<{
    projectId: string;
    channelId: string;
    collectionId: string;
    folderId: string;
    fileId: string;
  }>();

  // '_' is the sentinel for collection root (no folder)
  const resolvedFolderId = folderId === '_' ? null : (folderId ?? null);

  // Citation deep-links carry `?page=<N>` (1-based) so the PDF opens scrolled
  // to the cited chunk's page. Parse defensively — ignore non-numeric/<1 values
  // and leave the viewer at page 1.
  const [searchParams] = useSearchParams();
  const pageParam = Number(searchParams.get('page'));
  const initialPage = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : undefined;

  // `?chunkIndex=<K>` (0-based) identifies the cited chunk; FileViewerPanel
  // fetches its snippet and highlights it in the PDF via pdf.js find.
  const chunkParam = Number(searchParams.get('chunkIndex'));
  const initialChunkIndex =
    Number.isInteger(chunkParam) && chunkParam >= 0 ? chunkParam : undefined;

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
    currentFileId,
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

  // Lets the Contents panel highlight whichever file is currently open, the
  // same way it highlights the active folder. Cleared on unmount so leaving
  // the viewer (back to the folder browser) doesn't leave a stale file
  // highlighted.
  useEffect(() => {
    if (fileId && fileId !== currentFileId) setCurrentFileId(fileId);
  }, [fileId, currentFileId]);

  useEffect(() => {
    return () => setCurrentFileId(null);
  }, []);

  // This viewer is reachable both under /knowledge-base and /ai/knowledge —
  // Back must return to whichever of those it was opened from, not always
  // the standalone browser.
  const basePath = resolveKbBasePath(location.pathname);

  const getBackNavigationPath = (): string => {
    if (!collectionId) {
      return basePath;
    }
    // The listing screen lives at <basePath>?cl=&parent=, not under the old
    // path-param scheme. Build the search-params URL so Back returns the
    // user to the folder they came from instead of 404ing.
    const sp = new URLSearchParams();
    sp.set('cl', collectionId);
    if (resolvedFolderId) {
      sp.set('parent', resolvedFolderId);
    }
    return `${basePath}?${sp.toString()}`;
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
        {...(initialPage !== undefined ? { initialPage } : {})}
        {...(initialChunkIndex !== undefined ? { initialChunkIndex } : {})}
        onOpenChat={handleOpenChat}
      />
    </div>
  );
};
