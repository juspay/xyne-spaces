import React, { useCallback, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TreeSidebar } from '../tree/TreeSidebar';
import { FileBrowser } from './FileBrowser';
import { useProjectCollections } from '../hooks/useProjectCollections';
import { CollectionRole } from '../../../services/Knowledge/collectionService';
import { xyneAIActor } from '../../../machines/xyneAIMachine';

// localStorage keys
const STORAGE_KEY_SELECTED_COLLECTION_ID = 'kb_selected_collection_id';
const STORAGE_KEY_PROJECT_ID = 'kb_selected_project_id';
const STORAGE_KEY_CHANNEL_ID = 'kb_selected_channel_id';
const STORAGE_KEY_FOLDER_ID = 'kb_selected_folder_id';

/**
 * Layout for Tree mode
 * Shows collections sidebar + file list panel
 *
 * URL is the source of truth for projectId / channelId / collectionId.
 * localStorage is a fallback when URL has no params (e.g. user navigates
 * from another section of the app without a notification link).
 */
export const TreeLayout: React.FC = () => {
  const navigate = useNavigate();
  const params = useParams<{
    projectId?: string;
    channelId?: string;
    collectionId?: string;
    folderId?: string;
  }>();
  const routeProjectId = params.projectId || null;
  const routeChannelId = params.channelId || null;
  const routeCollectionId = params.collectionId || null;
  const routeFolderId = params.folderId || null;

  // Project, channel & collection context
  const {
    projectId,
    setProjectId,
    channelId,
    setChannelId,
    activeCollection,
    setActiveCollection,
  } = useProjectCollections();

  // Guard: only attempt localStorage redirect once (prevents loops)
  const hasAttemptedRedirect = useRef(false);

  // ── Phase 1: If URL is empty, try to restore from localStorage (mount only) ──
  useEffect(() => {
    if (hasAttemptedRedirect.current) return;
    hasAttemptedRedirect.current = true;

    // If URL already has projectId, nothing to restore
    if (routeProjectId) return;

    try {
      const storedProjectId = localStorage.getItem(STORAGE_KEY_PROJECT_ID);
      if (!storedProjectId) return; // Nothing stored – user starts fresh

      const storedChannelId = localStorage.getItem(STORAGE_KEY_CHANNEL_ID);
      const storedCollectionId = localStorage.getItem(STORAGE_KEY_SELECTED_COLLECTION_ID);
      const storedFolderId = localStorage.getItem(STORAGE_KEY_FOLDER_ID);

      if (storedChannelId && storedCollectionId) {
        if (storedFolderId) {
          void navigate(
            `/knowledge-base/${storedProjectId}/${storedChannelId}/${storedCollectionId}/${storedFolderId}`,
            { replace: true },
          );
        } else {
          void navigate(
            `/knowledge-base/${storedProjectId}/${storedChannelId}/${storedCollectionId}`,
            { replace: true },
          );
        }
      } else if (storedChannelId) {
        void navigate(`/knowledge-base/${storedProjectId}/${storedChannelId}`, { replace: true });
      } else {
        void navigate(`/knowledge-base/${storedProjectId}`, { replace: true });
      }
    } catch {
      // localStorage access failed – ignore
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-only

  // ── Phase 2: Sync URL params → Context ──
  // This runs whenever the URL changes (user click, notification link, popstate).
  // URL is the source of truth - we sync URL → Context, never Context → URL here.
  useEffect(() => {
    if (projectId !== routeProjectId) {
      setProjectId(routeProjectId);
    }

    if (channelId !== routeChannelId) {
      setChannelId(routeChannelId);
    }

    // Sync collectionId — set minimal info; TreeSidebar will resolve full details
    if (routeCollectionId) {
      if (activeCollection?.id !== routeCollectionId) {
        setActiveCollection({ id: routeCollectionId });
      }
    } else {
      if (activeCollection) {
        setActiveCollection(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeProjectId, routeChannelId, routeCollectionId]);

  // ── Phase 3: Persist to localStorage when context values change ──
  useEffect(() => {
    try {
      if (projectId) {
        localStorage.setItem(STORAGE_KEY_PROJECT_ID, projectId);
      } else {
        localStorage.removeItem(STORAGE_KEY_PROJECT_ID);
        localStorage.removeItem(STORAGE_KEY_CHANNEL_ID);
        localStorage.removeItem(STORAGE_KEY_SELECTED_COLLECTION_ID);
        localStorage.removeItem(STORAGE_KEY_FOLDER_ID);
      }
    } catch {
      // Failed to save, ignore silently
    }
  }, [projectId]);

  useEffect(() => {
    try {
      if (channelId) {
        localStorage.setItem(STORAGE_KEY_CHANNEL_ID, channelId);
      } else {
        localStorage.removeItem(STORAGE_KEY_CHANNEL_ID);
        localStorage.removeItem(STORAGE_KEY_SELECTED_COLLECTION_ID);
        localStorage.removeItem(STORAGE_KEY_FOLDER_ID);
      }
    } catch {
      // Failed to save, ignore silently
    }
  }, [channelId]);

  useEffect(() => {
    try {
      if (activeCollection) {
        localStorage.setItem(STORAGE_KEY_SELECTED_COLLECTION_ID, activeCollection.id);
      } else {
        localStorage.removeItem(STORAGE_KEY_SELECTED_COLLECTION_ID);
        localStorage.removeItem(STORAGE_KEY_FOLDER_ID);
      }
    } catch {
      // Failed to save, ignore silently
    }
  }, [activeCollection]);

  useEffect(() => {
    try {
      if (routeFolderId) {
        localStorage.setItem(STORAGE_KEY_FOLDER_ID, routeFolderId);
      } else {
        localStorage.removeItem(STORAGE_KEY_FOLDER_ID);
      }
    } catch {
      // Failed to save, ignore silently
    }
  }, [routeFolderId]);

  // ── Handlers ──

  const handleSelectProject = (newProjectId: string | null): void => {
    if (newProjectId) {
      void navigate(`/knowledge-base/${newProjectId}`);
    } else {
      void navigate('/knowledge-base');
    }
  };

  const handleSelectChannel = (newChannelId: string | null): void => {
    const pid = routeProjectId || projectId;
    if (newChannelId && pid) {
      void navigate(`/knowledge-base/${pid}/${newChannelId}`);
    } else if (pid) {
      void navigate(`/knowledge-base/${pid}`);
    }
  };

  const handleSelectCollection = (
    collectionId: string | null,
    collectionName?: string,
    collectionRole?: CollectionRole,
    collectionCanShare?: boolean,
    ownerId?: string,
  ): void => {
    const pid = routeProjectId || projectId;
    const cid = routeChannelId || channelId;
    if (collectionId && pid && cid) {
      setActiveCollection({
        id: collectionId,
        name: collectionName,
        role: collectionRole,
        canShare: collectionCanShare,
        ownerId: ownerId,
      });
      void navigate(`/knowledge-base/${pid}/${cid}/${collectionId}`);
    } else if (!collectionId) {
      setActiveCollection(null);
      if (pid && cid) {
        void navigate(`/knowledge-base/${pid}/${cid}`);
      } else if (pid) {
        void navigate(`/knowledge-base/${pid}`);
      }
    }
  };

  const activeCollectionId = activeCollection?.id ?? null;

  // Open XyneAI with Knowledge Base context
  const handleOpenXyneAI = useCallback(
    (docId?: string, _docName?: string) => {
      const kbContext = {
        projectId: projectId || 'default',
        channelId: channelId || undefined,
        collectionId: activeCollectionId || undefined,
        parentDocId: routeFolderId || undefined,
        docId,
      };
      sessionStorage.setItem('kb_xyne_ai_context', JSON.stringify(kbContext));

      xyneAIActor.send({
        type: 'OPEN',
        startFreshChat: true,
        kbCollectionId: activeCollectionId,
        kbChannelId: channelId ?? null,
      });
    },
    [projectId, channelId, activeCollectionId, routeFolderId],
  );

  // Keep machine KB context in sync with the active collection/project
  useEffect(() => {
    if (projectId) {
      xyneAIActor.send({
        type: 'SET_KB_CONTEXT',
        kbCollectionId: activeCollectionId ?? null,
        kbChannelId: channelId ?? null,
      });
    }
  }, [projectId, activeCollectionId]);

  // Clear KB context from machine on unmount (navigating away from KB)
  useEffect(() => {
    return () => {
      xyneAIActor.send({ type: 'CLEAR_KB_CONTEXT' });
    };
  }, []);

  return (
    <div className='flex h-full md:rounded-2xl shadow-md overflow-hidden'>
      {/* Collections Sidebar */}
      <div className='w-64 border-r bg-white flex-shrink-0'>
        <TreeSidebar
          selectedCollectionId={activeCollectionId}
          onSelectCollection={handleSelectCollection}
          selectedProjectId={projectId}
          onSelectProject={handleSelectProject}
          selectedChannelId={channelId}
          onSelectChannel={handleSelectChannel}
        />
      </div>

      {/* File Browser - reads from CollectionTreeContext */}
      <div className='flex-1 overflow-hidden'>
        <FileBrowser
          selectedCollectionId={activeCollectionId}
          collectionName={activeCollection?.name}
          onOpenChat={(docId, docName): void => {
            handleOpenXyneAI(docId, docName);
          }}
        />
      </div>
    </div>
  );
};
