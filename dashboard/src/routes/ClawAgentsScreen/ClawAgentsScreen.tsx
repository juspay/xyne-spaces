import { ReactElement } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Outlet } from 'react-router-dom';
import ClawAgentsSidebar from '@/components/ClawAgents/ClawAgentsSidebar';

const ClawAgentsScreen = (): ReactElement => {
  return (
    <div className='flex h-full flex-col md:rounded-2xl overflow-hidden'>
      <PanelGroup
        direction='horizontal'
        className='flex-1 overflow-hidden'
        autoSaveId='claw-agents-panel-layout'
      >
        <Panel defaultSize={20} minSize={16} maxSize={25} id='sidebar' order={1}>
          <ClawAgentsSidebar />
        </Panel>

        <PanelResizeHandle className='w-[2px] transition-colors cursor-col-resize flex items-center justify-center group'>
          <div className='w-[2px] h-full bg-sidebar-divider group-hover:bg-sidebar-badge-accent group-active:bg-sidebar-badge-accent' />
        </PanelResizeHandle>

        <Panel defaultSize={80} minSize={75} maxSize={84} id='main' order={2}>
          <div className='h-full flex flex-col overflow-auto no-scrollbar bg-background'>
            <Outlet />
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
};

export default ClawAgentsScreen;
