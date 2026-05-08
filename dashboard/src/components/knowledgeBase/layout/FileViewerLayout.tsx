import React, { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSelector } from '@xstate/react';
import { ArrowLeft } from 'lucide-react';
import { CollectionTreeSidebar } from '../viewer/CollectionTreeSidebar';
import { FileViewerPanel } from '../viewer/FileViewerPanel';
import { useSetKBChat } from '../context/KBChatContext';
import XyneAISidebar from '../../Chat/XyneAISidebar/XyneAISidebar';
import { xyneAIActor } from '../../../machines/xyneAIMachine';

export const FileViewerLayout: React.FC = () => {
  const navigate = useNavigate();
  const { projectId, collectionId, folderId, fileId } = useParams<{
    projectId: string;
    collectionId: string;
    folderId: string;
    fileId: string;
  }>();

  // '_' is the sentinel for collection root (no folder)
  const resolvedFolderId = folderId === '_' ? null : (folderId ?? null);

  // Subscribe to XyneAI state from xstate machine (single source of truth)
  const xyneAIState = useSelector(xyneAIActor, state => state);
  const isChatOpen = xyneAIState.matches('open');

  // Open XyneAI with Knowledge Base context
  const handleOpenChat = (docId: string, _docName: string): void => {
    // Store KB context in sessionStorage for the XyneAI session
    const kbContext = {
      projectId: projectId || 'default',
      collectionId: collectionId || undefined,
      parentDocId: resolvedFolderId || undefined,
      docId,
    };
    sessionStorage.setItem('kb_xyne_ai_context', JSON.stringify(kbContext));

    // Open XyneAI via xstate machine (consistent with rest of app)
    xyneAIActor.send({
      type: 'OPEN',
      startFreshChat: true,
    });
  };

  const getBackNavigationPath = (): string => {
    if (!collectionId || !projectId) {
      return '/knowledge-base';
    }

    if (resolvedFolderId) {
      return `/knowledge-base/${projectId}/${collectionId}/${resolvedFolderId}`;
    }
    return `/knowledge-base/${projectId}/${collectionId}`;
  };

  const handleBack = (): void => {
    void navigate(getBackNavigationPath());
  };

  // Push XyneAISidebar into KnowledgeBaseLayout's right panel via context
  const setChatNode = useSetKBChat();

  useEffect(() => {
    if (isChatOpen) {
      setChatNode(
        <XyneAISidebar
          key='kb-fileviewer-xayne-ai'
          channelId={null}
          startFreshChat={xyneAIState.context.startFreshChat}
          kbCollectionId={collectionId ?? ''}
          kbProjectId={projectId ?? ''}
        />,
      );
    } else {
      setChatNode(null);
    }
  }, [isChatOpen, setChatNode, collectionId, projectId, xyneAIState.context.startFreshChat]);

  // Clear slot on unmount
  useEffect(() => {
    return () => setChatNode(null);
  }, [setChatNode]);

  return (
    <div className='flex h-full'>
      {/* Left Column: Back Button + Collection Tree Sidebar */}
      <div className='w-64 border-r bg-white flex-shrink-0 flex flex-col'>
        {/* Back Button */}
        <div className='px-4 py-2 bg-white flex-shrink-0'>
          <button
            onClick={handleBack}
            className='flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors'
            aria-label='Back to collections'
            data-track-category='knowledge-base'
            data-track-name='back-to-collections'
          >
            <ArrowLeft size={16} />
          </button>
        </div>

        {/* Collection Tree Sidebar */}
        <div className='flex-1 overflow-hidden'>
          <CollectionTreeSidebar />
        </div>
      </div>

      {/* Right Column: File Viewer */}
      <div className='flex-1 overflow-hidden'>
        <FileViewerPanel
          handleBackNavigation={handleBack}
          fileId={fileId}
          onOpenChat={handleOpenChat}
        />
      </div>
    </div>
  );
};
