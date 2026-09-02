import { ReactElement } from 'react';
import { Outlet } from 'react-router-dom';
import { Panel, ResizableGroup, Separator } from '../../components/ui/Resizable/Resizable';
import AutomationsSidebar from '../../components/Automation/AutomationsSidebar/AutomationsSidebar';
import {
  AUTOMATIONS_SIDEBAR_DEFAULT_WIDTH,
  AUTOMATIONS_SIDEBAR_MAX_WIDTH,
  AUTOMATIONS_SIDEBAR_MIN_WIDTH,
} from './automationsSidebarWidth';

const AutomationsScreen = (): ReactElement => {
  return (
    <div className='h-full relative overflow-hidden' data-component='AutomationsScreen'>
      <ResizableGroup
        orientation='horizontal'
        className='flex align-top h-full'
        autoSaveId='automations-panel-layout'
      >
        <Panel
          id='sidebar'
          defaultSize={AUTOMATIONS_SIDEBAR_DEFAULT_WIDTH}
          minSize={AUTOMATIONS_SIDEBAR_MIN_WIDTH}
          maxSize={AUTOMATIONS_SIDEBAR_MAX_WIDTH}
          groupResizeBehavior='preserve-pixel-size'
        >
          <aside className='w-full h-full'>
            <AutomationsSidebar />
          </aside>
        </Panel>

        <Separator className='w-[2px] transition-colors cursor-col-resize flex items-center justify-center group'>
          <div
            id='panel-resize-divider'
            className='w-[2px] h-full bg-sidebar-divider group-hover:bg-primary group-active:bg-primary'
          />
        </Separator>

        <Panel defaultSize='80%' minSize='30%' id='main'>
          <main
            data-id='automations-view'
            className='flex-1 h-full overflow-hidden relative flex flex-col rounded-2xl border border-border bg-background'
          >
            <div className='flex-1 overflow-hidden relative flex flex-col'>
              <Outlet />
            </div>
          </main>
        </Panel>
      </ResizableGroup>
    </div>
  );
};

export default AutomationsScreen;
