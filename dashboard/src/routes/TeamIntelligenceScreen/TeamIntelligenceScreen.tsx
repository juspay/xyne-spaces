import TeamIntelligenceHeader from '@/components/TeamIntelligence/TeamIntelligenceHeader';
import TeamIntelligenceSidebar from '@/components/TeamIntelligence/TeamIntelligenceSidebar';
import { getDateRange, TimeRange } from '@/utils/teamIntelligenceUtils';
import { useWindowWidth } from '@/hooks/useWindowWidth';
import React, { ReactElement, useEffect, useMemo, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Outlet } from 'react-router-dom';
import Drawer from '@/components/ui/Drawer';

export interface TeamIntelligenceOutletContext {
  isSidebarOpen: boolean;
  setIsSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  timeRange: TimeRange;
  setTimeRange: React.Dispatch<React.SetStateAction<TimeRange>>;
  dateRange: { from: string; to: string };
}

interface LayoutProps {
  isSidebarOpen: boolean;
  setIsSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  timeRange: TimeRange;
  setTimeRange: React.Dispatch<React.SetStateAction<TimeRange>>;
  dateRange: { from: string; to: string };
}

/* Aligned with Tailwind breakpoints */
const SM = 640; // mobile ↔ tablet
const LG = 1024; // tablet ↔ desktop

const TeamIntelligenceScreen = (): ReactElement => {
  const windowWidth = useWindowWidth();

  // Derive mode from width (matches Tailwind responsive classes)
  const isMobile = windowWidth < SM;
  const isTablet = windowWidth >= SM && windowWidth < LG;
  const isDesktop = windowWidth >= LG;

  const [timeRange, setTimeRange] = useState<TimeRange>(TimeRange.LAST_WEEK);
  const dateRange = useMemo(() => getDateRange(timeRange), [timeRange]);

  // Sidebar open by default only on desktop
  const [isSidebarOpen, setIsSidebarOpen] = useState(isDesktop);

  // Auto-adjust sidebar when crossing breakpoints
  useEffect(() => {
    if (isDesktop) {
      setIsSidebarOpen(true);
    } else {
      setIsSidebarOpen(false);
    }
  }, [isDesktop]);

  const commonProps: LayoutProps = {
    isSidebarOpen,
    setIsSidebarOpen,
    timeRange,
    setTimeRange,
    dateRange,
  };

  return (
    <div className='flex h-full flex-col md:rounded-2xl overflow-hidden'>
      {isMobile || isTablet ? (
        <MobileLayout {...commonProps} />
      ) : (
        <DesktopLayout {...commonProps} />
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════ */
// Mobile  (< 640px)
/* ═══════════════════════════════════════════════════════════════ */

function MobileLayout({
  isSidebarOpen,
  setIsSidebarOpen,
  timeRange,
  setTimeRange,
  dateRange,
}: LayoutProps): ReactElement {
  return (
    <div className='flex flex-col h-full'>
      <div className='sticky top-0 w-full z-20 border-b border-sidebar-divider bg-background'>
        <TeamIntelligenceHeader
          isSidebarOpen={isSidebarOpen}
          setIsSidebarOpen={setIsSidebarOpen}
          timeRange={timeRange}
          setTimeRange={setTimeRange}
        />
      </div>
      <div className='flex-1 overflow-auto no-scrollbar bg-background pb-20'>
        <Outlet context={{ isSidebarOpen, setIsSidebarOpen, timeRange, setTimeRange, dateRange }} />
      </div>

      <Drawer
        open={isSidebarOpen}
        onOpenChange={setIsSidebarOpen}
        title='Team Intelligence Navigation'
      >
        <TeamIntelligenceSidebar
          isSidebarOpen={isSidebarOpen}
          setIsSidebarOpen={setIsSidebarOpen}
          showCollapseButton={false}
          closeOnNavigate={true}
        />
      </Drawer>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════ */
// Desktop  (> 1024px) — resizable panels
/* ═══════════════════════════════════════════════════════════════ */

function DesktopLayout({
  isSidebarOpen,
  setIsSidebarOpen,
  timeRange,
  setTimeRange,
  dateRange,
}: LayoutProps): ReactElement {
  return (
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
              showCollapseButton={true}
            />
          </Panel>
          <PanelResizeHandle className='w-[2px] transition-colors cursor-col-resize flex items-center justify-center group'>
            <div className='w-[2px] h-full bg-sidebar-divider group-hover:bg-sidebar-badge-accent group-active:bg-sidebar-badge-accent' />
          </PanelResizeHandle>
        </React.Fragment>
      ) : null}

      <Panel defaultSize={80} minSize={75} maxSize={84} id='main' order={2}>
        <div className='h-full flex flex-col overflow-auto no-scrollbar bg-background'>
          <div className='sticky top-0 w-full z-20 border-b border-sidebar-divider'>
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
  );
}

export default TeamIntelligenceScreen;
