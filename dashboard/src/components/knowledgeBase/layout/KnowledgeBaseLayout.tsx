import React from 'react';
import { Outlet } from 'react-router-dom';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { ProjectCollectionsProvider } from '../context/ProjectCollectionsContext';
import { CollectionTreeProvider } from '../context/CollectionTreeContext';
import { KBChatProvider, useKBChatNode } from '../context/KBChatContext';

const KBLayoutInner: React.FC = () => {
  const chatNode = useKBChatNode();

  // Always keep PanelGroup in the tree so <Outlet> (TreeLayout/FileViewerLayout) is never
  // remounted when the chat panel opens. Remounting would reset isChatOpen → false,
  // immediately clearing chatNode again (loop that prevents the sidebar from opening).
  return (
    <PanelGroup direction='horizontal' className='h-full' autoSaveId='kb-chat-layout'>
      <Panel key='kb-main' id='kb-main' order={1} minSize={30}>
        <div className='h-full relative z-0 md:rounded-2xl overflow-hidden shadow-[0_0_8px_0_rgba(0,0,0,0.15)] flex flex-col bg-gray-50'>
          <Outlet />
        </div>
      </Panel>
      {chatNode && (
        <>
          <PanelResizeHandle className='w-1 hover:bg-sidebar-divider active:bg-sidebar-divider transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
            <div className='w-0.5 h-8 bg-transparent group-hover:bg-sidebar-divider group-active:bg-sidebar-divider transition-colors duration-200 rounded-full' />
          </PanelResizeHandle>
          <Panel key='kb-chat' id='kb-chat' order={2} defaultSize={35} maxSize={60} minSize={20}>
            {chatNode}
          </Panel>
        </>
      )}
    </PanelGroup>
  );
};

/**
 * Main layout component for Knowledge Base
 *
 * Provider hierarchy:
 * - KBChatProvider: Allows child layouts to slot a ChatOverlay into the right panel
 * - ProjectCollectionsProvider: Manages collection list + project room subscription
 * - CollectionTreeProvider: Manages node tree + collection room subscription
 *
 * The PanelGroup lives here so the chat panel sits alongside the entire rounded
 * KB container (matching XyneAISidebar's layout pattern in AppRoot).
 */
export const KnowledgeBaseLayout: React.FC = () => {
  return (
    <KBChatProvider>
      <ProjectCollectionsProvider>
        <CollectionTreeProvider>
          <KBLayoutInner />
        </CollectionTreeProvider>
      </ProjectCollectionsProvider>
    </KBChatProvider>
  );
};
