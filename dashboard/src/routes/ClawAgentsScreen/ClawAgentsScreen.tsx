import { ReactElement } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Outlet } from 'react-router-dom';
import ClawAgentsSidebar from '@/components/ClawAgents/ClawAgentsSidebar';

const ClawAgentsScreen = (): ReactElement => {
  return (
    <div className='h-full relative overflow-hidden' data-component='ClawAgentsScreen'>
      <PanelGroup
        direction='horizontal'
        className='flex align-top h-full'
        autoSaveId='claw-agents-panel-layout'
      >
        <Panel defaultSize={20} minSize={15} maxSize={30} id='sidebar' order={1}>
          <aside className='w-full h-full'>
            <ClawAgentsSidebar />
          </aside>
        </Panel>

        <PanelResizeHandle className='w-[2px] transition-colors cursor-col-resize flex items-center justify-center group'>
          <div
            id='panel-resize-divider'
            className='w-[2px] h-full bg-sidebar-divider group-hover:bg-primary group-active:bg-primary'
          />
        </PanelResizeHandle>

        <Panel defaultSize={80} minSize={30} id='main' order={2}>
          <main
            data-id='claw-agents-view'
            className='flex-1 h-full overflow-hidden relative flex flex-col rounded-2xl border border-border bg-background'
          >
            <div className='flex-1 overflow-auto no-scrollbar relative'>
              <Outlet />
            </div>
          </main>
        </Panel>
      </PanelGroup>
    </div>
  );
};

export default ClawAgentsScreen;
