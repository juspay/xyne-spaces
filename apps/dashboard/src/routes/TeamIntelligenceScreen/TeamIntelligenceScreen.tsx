import TeamIntelligenceHeader from '@/components/TeamIntelligence/TeamIntelligenceHeader';
import TeamIntelligenceSidebar from '@/components/TeamIntelligence/TeamIntelligenceSidebar';
import { getDateRange, TimeRange } from '@/utils/teamIntelligenceUtils';
import { useWindowWidth } from '@/hooks/useWindowWidth';
import React, { ReactElement, useEffect, useMemo, useState } from 'react';
import { Panel, ResizableGroup, Separator } from '../../components/ui/Resizable/Resizable';
import {
  TEAM_INTELLIGENCE_SIDEBAR_DEFAULT_WIDTH,
  TEAM_INTELLIGENCE_SIDEBAR_MAX_WIDTH,
  TEAM_INTELLIGENCE_SIDEBAR_MIN_WIDTH,
} from './teamIntelligenceSidebarWidth';
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

  const getDefaultTimeRange = (): TimeRange => {
    const today = new Date();
    return today.getDay() === 1 ? TimeRange.LAST_WEEK : TimeRange.THIS_WEEK;
  };

  const [timeRange, setTimeRange] = useState<TimeRange>(getDefaultTimeRange);
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
    <ResizableGroup
      orientation='horizontal'
      className='flex-1 overflow-hidden'
      autoSaveId='team-intelligence-panel-layout'
      panelIds={isSidebarOpen ? ['sidebar', 'main'] : ['main']}
    >
      {isSidebarOpen ? (
        <React.Fragment>
          <Panel
            id='sidebar'
            defaultSize={TEAM_INTELLIGENCE_SIDEBAR_DEFAULT_WIDTH}
            minSize={TEAM_INTELLIGENCE_SIDEBAR_MIN_WIDTH}
            maxSize={TEAM_INTELLIGENCE_SIDEBAR_MAX_WIDTH}
            groupResizeBehavior='preserve-pixel-size'
          >
            <TeamIntelligenceSidebar
              isSidebarOpen={isSidebarOpen}
              setIsSidebarOpen={setIsSidebarOpen}
              showCollapseButton={true}
            />
          </Panel>
          <Separator className='w-[2px] transition-colors cursor-col-resize flex items-center justify-center group'>
            <div className='w-[2px] h-full bg-sidebar-divider group-hover:bg-primary group-active:bg-primary' />
          </Separator>
        </React.Fragment>
      ) : null}

      {/* No size constraints — the pixel-pinned sidebar takes its width and this panel
          grows to fill the rest. A percentage min/max here would fight the pin and
          force the sidebar to scale with the window again. */}
      <Panel id='main'>
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
    </ResizableGroup>
  );
}

export default TeamIntelligenceScreen;
