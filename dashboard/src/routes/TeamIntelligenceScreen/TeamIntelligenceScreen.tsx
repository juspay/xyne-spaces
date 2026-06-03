import TeamIntelligenceHeader from '@/components/TeamIntelligence/TeamIntelligenceHeader';
import TeamIntelligenceSidebar from '@/components/TeamIntelligence/TeamIntelligenceSidebar';
import { getDateRange, TimeRange } from '@/utils/teamIntelligenceUtils';
import React, { ReactElement, useMemo, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Outlet } from 'react-router-dom';

export interface TeamIntelligenceOutletContext {
  isSidebarOpen: boolean;
  setIsSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  timeRange: TimeRange;
  setTimeRange: React.Dispatch<React.SetStateAction<TimeRange>>;
  dateRange: { from: string; to: string };
}

const TeamIntelligenceScreen = (): ReactElement => {
  const [timeRange, setTimeRange] = useState<TimeRange>(TimeRange.LAST_WEEK);
  const dateRange = useMemo(() => getDateRange(timeRange), [timeRange]);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);

  return (
    <div className='flex h-full flex-col md:rounded-2xl overflow-hidden'>
      <PanelGroup
        direction='horizontal'
        className='flex-1 overflow-hidden'
        autoSaveId='team-intelligence-panel-layout'
      >
        {isSidebarOpen ? (
          <React.Fragment>
            <Panel defaultSize={20} minSize={16} maxSize={25} id='sidebar' order={1}>
              <TeamIntelligenceSidebar
                isSidebarOpen={isSidebarOpen}
                setIsSidebarOpen={setIsSidebarOpen}
              />
            </Panel>
            <PanelResizeHandle className='w-[2px] transition-colors cursor-col-resize flex items-center justify-center group'>
              <div className='w-[2px] h-full bg-sidebar-divider group-hover:bg-sidebar-badge-accent group-active:bg-sidebar-badge-accent'></div>
            </PanelResizeHandle>
          </React.Fragment>
        ) : null}

        <Panel defaultSize={80} minSize={75} maxSize={84} id='main' order={2}>
          <div className='h-full flex flex-col overflow-auto no-scrollbar bg-background'>
            <div className='sticky top-0 w-full z-20'>
              <TeamIntelligenceHeader
                isSidebarOpen={isSidebarOpen}
                setIsSidebarOpen={setIsSidebarOpen}
                timeRange={timeRange}
                setTimeRange={setTimeRange}
              />
            </div>
            <Outlet
              context={{ isSidebarOpen, setIsSidebarOpen, timeRange, setTimeRange, dateRange }}
            />
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
};

export default TeamIntelligenceScreen;
