import React, { useCallback, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSelector } from '@xstate/react';
import { TreeSidebar } from '../tree/TreeSidebar';
import { FileBrowser } from './FileBrowser';
import { useProjectCollections } from '../context/ProjectCollectionsContext';
import { CollectionRole } from '../../../services/Knowledge/collectionService';
import { useSetKBChat } from '../context/KBChatContext';
import XyneAISidebar from '../../Chat/XyneAISidebar/XyneAISidebar';
import { xyneAIActor } from '../../../machines/xyneAIMachine';

// localStorage keys
const STORAGE_KEY_SELECTED_COLLECTION_ID = 'kb_selected_collection_id';
const STORAGE_KEY_PROJECT_ID = 'kb_selected_project_id';
const STORAGE_KEY_FOLDER_ID = 'kb_selected_folder_id';

/**
 * Layout for Tree mode
 * Shows collections sidebar + file list panel
 *
 * URL is the source of truth for projectId / collectionId.
 * localStorage is a fallback when URL has no params (e.g. user navigates
 * from another section of the app without a notification link).
 */
export const TreeLayout: React.FC = () => {
  const navigate = useNavigate();
  const params = useParams<{ projectId?: string; collectionId?: string; folderId?: string }>();
  const routeProjectId = params.projectId || null;
  const routeCollectionId = params.collectionId || null;
  const routeFolderId = params.folderId || null;

  // Project & collection context
  const { projectId, setProjectId, activeCollection, setActiveCollection } =
    useProjectCollections();

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

      const storedCollectionId = localStorage.getItem(STORAGE_KEY_SELECTED_COLLECTION_ID);
      const storedFolderId = localStorage.getItem(STORAGE_KEY_FOLDER_ID);

      if (storedCollectionId) {
        if (storedFolderId) {
          void navigate(
            `/knowledge-base/${storedProjectId}/${storedCollectionId}/${storedFolderId}`,
            { replace: true },
          );
        } else {
          void navigate(`/knowledge-base/${storedProjectId}/${storedCollectionId}`, {
            replace: true,
          });
        }
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
    // Sync projectId (only if changed to avoid unnecessary updates)
    if (projectId !== routeProjectId) {
      setProjectId(routeProjectId);
    }

    // Sync collectionId — set minimal info; TreeSidebar will resolve full details
    if (routeCollectionId) {
      // Only update if the collection actually changed to avoid overwriting
      // resolved info (name/role/canShare) that TreeSidebar already pushed.
      if (activeCollection?.id !== routeCollectionId) {
        setActiveCollection({ id: routeCollectionId });
      }
    } else {
      // URL has no collection → clear (unless setProjectId already cleared it)
      if (activeCollection) {
        setActiveCollection(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeProjectId, routeCollectionId]);

  // ── Phase 3: Persist to localStorage when context values change ──
  useEffect(() => {
    try {
      if (projectId) {
        localStorage.setItem(STORAGE_KEY_PROJECT_ID, projectId);
      } else {
        localStorage.removeItem(STORAGE_KEY_PROJECT_ID);
        localStorage.removeItem(STORAGE_KEY_SELECTED_COLLECTION_ID);
        localStorage.removeItem(STORAGE_KEY_FOLDER_ID);
      }
    } catch {
      // Failed to save, ignore silently
    }
  }, [projectId]);

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

  const handleSelectCollection = (
    collectionId: string | null,
    collectionName?: string,
    collectionRole?: CollectionRole,
    collectionCanShare?: boolean,
    ownerId?: string,
  ): void => {
    const pid = routeProjectId || projectId;
    if (collectionId && pid) {
      setActiveCollection({
        id: collectionId,
        name: collectionName,
        role: collectionRole,
        canShare: collectionCanShare,
        ownerId: ownerId,
      });
      void navigate(`/knowledge-base/${pid}/${collectionId}`);
    } else if (!collectionId) {
      setActiveCollection(null);
      if (pid) {
        void navigate(`/knowledge-base/${pid}`);
      }
    }
  };

  const activeCollectionId = activeCollection?.id ?? null;

  // Subscribe to XyneAI state from xstate machine (single source of truth)
  const xyneAIState = useSelector(xyneAIActor, state => state);
  const isChatOpen = xyneAIState.matches('open');

  // Open XyneAI with Knowledge Base context
  const handleOpenXyneAI = useCallback(
    (docId?: string, _docName?: string) => {
      // Store KB context in sessionStorage for the XyneAI session (fallback)
      const kbContext = {
        projectId: projectId || 'default',
        collectionId: activeCollectionId || undefined,
        parentDocId: routeFolderId || undefined,
        docId,
      };
      sessionStorage.setItem('kb_xyne_ai_context', JSON.stringify(kbContext));

      // Open XyneAI via xstate machine (consistent with rest of app)
      xyneAIActor.send({
        type: 'OPEN',
        startFreshChat: true,
      });
    },
    [projectId, activeCollectionId, routeFolderId],
  );

  // Push XyneAISidebar into KnowledgeBaseLayout's right panel via context
  const setChatNode = useSetKBChat();

  useEffect(() => {
    if (isChatOpen) {
      setChatNode(
        <XyneAISidebar
          key='kb-tree-xayne-ai'
          channelId={null}
          startFreshChat={xyneAIState.context.startFreshChat}
          kbCollectionId={activeCollectionId ?? ''}
          kbProjectId={projectId ?? ''}
        />,
      );
    } else {
      setChatNode(null);
    }
  }, [isChatOpen, setChatNode, activeCollectionId, projectId, xyneAIState.context.startFreshChat]);

  // Clear slot on unmount (route change to FileViewerLayout, etc.)
  useEffect(() => {
    return () => setChatNode(null);
  }, [setChatNode]);

  return (
    <div className='flex h-full'>
      {/* Collections Sidebar */}
      <div className='w-64 border-r bg-white flex-shrink-0'>
        <TreeSidebar
          selectedCollectionId={activeCollectionId}
          onSelectCollection={handleSelectCollection}
          selectedProjectId={projectId}
          onSelectProject={handleSelectProject}
        />
      </div>

      {/* File Browser - reads from CollectionTreeContext */}
      <div className='flex-1 overflow-hidden'>
        <FileBrowser
          selectedCollectionId={activeCollectionId}
          collectionName={activeCollection?.name}
          collectionRole={activeCollection?.role}
          onOpenChat={(docId, docName): void => {
            handleOpenXyneAI(docId, docName);
          }}
        />
      </div>
    </div>
  );
};
