import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { SidebarLeftOpen } from '@xyne/icons';
import { Tooltip } from '../../components/ui/Tooltip/Tooltip';
import {
  ResizableGroup,
  Panel,
  Separator,
  usePanelRef,
  type PanelSize,
} from '../../components/ui/Resizable/Resizable';
import {
  PROJECTS_SIDEBAR_DEFAULT_WIDTH,
  PROJECTS_SIDEBAR_MAX_WIDTH,
  PROJECTS_SIDEBAR_MIN_WIDTH,
} from './projectsSidebarWidth';
import { ProjectSidebar } from '../../components/Project';
import { usePlatform } from '../../hooks/usePlatform';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { ExpandedTicketView } from '../../components/Tickets/ExpandedTicketView/ExpandedTicketView';

export type ProjectsScreenOutletContext = {
  leftHeaderSlot?: ReactElement | null;
  openTicket?: (
    ticket: { id: string; conversationId: string },
    options: { newTab: boolean; trackSource: string },
  ) => void;
};

const ProjectsScreen = (): ReactElement => {
  const location = useLocation();
  const { workspaceId, ticketId } = useParams<{ workspaceId?: string; ticketId?: string }>();
  const { isMobile } = usePlatform();
  const { isWideScreen, containerRef } = useResizablePanel({ isMobile });

  const sidebarPanelRef = usePanelRef();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const toggleSidebar = useCallback((): void => {
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  }, [sidebarPanelRef]);

  const [searchParams, setSearchParams] = useSearchParams();
  const setSearchParamsRef = useRef(setSearchParams);
  setSearchParamsRef.current = setSearchParams;
  const openTicketId = searchParams.get('ticketId');
  const openConversationId = searchParams.get('conversationId');
  const [openTicket, openTicketDetails] = useCachedQuery(
    queries.ticketByIdV2({ ticketId: openTicketId ?? '' }),
    { enabled: !!openTicketId },
  );

  const openTicketInPlace = useCallback<NonNullable<ProjectsScreenOutletContext['openTicket']>>(
    (ticket, { newTab, trackSource }) => {
      const params = new URLSearchParams(window.location.search);
      params.set('ticketId', ticket.id);
      params.set('conversationId', ticket.conversationId);
      if (newTab) {
        window.open(`${window.location.pathname}?${params.toString()}`, '_blank');
        return;
      }
      setSearchParamsRef.current(params, { state: { trackSource } });
    },
    [],
  );

  const closeTicket = useCallback((): void => {
    setSearchParamsRef.current(prev => {
      const next = new URLSearchParams(prev);
      next.delete('ticketId');
      next.delete('conversationId');
      next.delete('nofocus');
      return next;
    });
  }, []);

  const outletContext = useMemo<ProjectsScreenOutletContext>(
    () => ({
      leftHeaderSlot: isSidebarCollapsed ? (
        <Tooltip content='Show ticket views' side='bottom' delayDuration={300}>
          <button
            type='button'
            onClick={toggleSidebar}
            aria-label='Expand sidebar'
            aria-controls='projects-sidebar-region'
            className='-ml-1 flex size-[30px] shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
            data-track-category='Projects'
            data-track-name='ToggleProjectsSidebar'
          >
            <SidebarLeftOpen className='size-4' />
          </button>
        </Tooltip>
      ) : null,
      openTicket: openTicketInPlace,
    }),
    [isSidebarCollapsed, toggleSidebar, openTicketInPlace],
  );

  const ticketsRootPath = `/${workspaceId}/projects`;
  const lastTicketsPathKey = `lastTicketsPath_${workspaceId}`;
  const isAtTicketsRoot = location.pathname === ticketsRootPath && !location.search;
  const [entryRedirect, setEntryRedirect] = useState(() =>
    isAtTicketsRoot ? localStorage.getItem(lastTicketsPathKey) : null,
  );
  const redirectTo =
    isAtTicketsRoot && entryRedirect && entryRedirect !== ticketsRootPath ? entryRedirect : null;

  useEffect(() => {
    if (redirectTo) return;
    setEntryRedirect(null);
    if (!ticketId && !openTicketId) {
      const params = new URLSearchParams(location.search);
      params.delete('search');
      const query = params.toString();
      localStorage.setItem(
        lastTicketsPathKey,
        query ? `${location.pathname}?${query}` : location.pathname,
      );
    }
  }, [redirectTo, ticketId, openTicketId, lastTicketsPathKey, location.pathname, location.search]);

  if (redirectTo) return <Navigate to={redirectTo} replace />;

  return (
    <div
      ref={containerRef}
      data-testid='list-projects-page'
      className='h-full relative overflow-hidden'
      data-component='ProjectsScreen'
    >
      {isWideScreen ? (
        <ResizableGroup
          orientation='horizontal'
          className='flex align-top h-full'
          autoSaveId='projects-screen-resize'
        >
          {/* LEFT PANEL (Sidebar) */}
          <Panel
            id='projects-sidebar'
            panelRef={sidebarPanelRef}
            defaultSize={PROJECTS_SIDEBAR_DEFAULT_WIDTH}
            minSize={PROJECTS_SIDEBAR_MIN_WIDTH}
            maxSize={PROJECTS_SIDEBAR_MAX_WIDTH}
            groupResizeBehavior='preserve-pixel-size'
            collapsible
            collapsedSize={0}
            onResize={(size: PanelSize) => setIsSidebarCollapsed(size.inPixels === 0)}
          >
            <aside id='projects-sidebar-region' className='w-full h-full'>
              <ProjectSidebar onToggleCollapse={toggleSidebar} />
            </aside>
          </Panel>

          {/* RESIZE HANDLE */}
          <Separator className='w-[2px] transition-colors cursor-col-resize flex items-center justify-center group'>
            <div
              id='panel-resize-divider'
              className='w-[2px] h-full bg-sidebar-divider group-hover:bg-primary group-active:bg-primary'
            ></div>
          </Separator>

          {/* RIGHT PANEL (Content View) */}
          <Panel id='projects-content'>
            <main
              data-id='projects-content-view'
              className='flex-1 h-full overflow-hidden relative flex flex-col rounded-2xl border border-border bg-background'
            >
              <div className='flex-1 overflow-hidden relative'>
                {openTicketId && openConversationId ? (
                  openTicket ? (
                    <ExpandedTicketView
                      ticketId={openTicketId}
                      channelId={openTicket.channelId}
                      conversationId={openConversationId}
                      onMinimize={closeTicket}
                    />
                  ) : openTicketDetails.type === 'complete' ? (
                    <div className='h-full flex items-center justify-center text-sm text-muted-foreground'>
                      This ticket doesn&apos;t exist or isn&apos;t available.
                    </div>
                  ) : null
                ) : (
                  <Outlet context={outletContext} />
                )}
              </div>
            </main>
          </Panel>
        </ResizableGroup>
      ) : (
        // Narrow screen: Overlay pattern
        <>
          <aside className='h-full min-[500px]:px-4 border-r border-border'>
            {/* Placeholder for Project Directory */}
            <div className='h-full flex items-center justify-center text-muted-foreground'>
              Project Directory Placeholder
            </div>
          </aside>
          {/* Content overlay - Show when not on root projects path */}
          {location.pathname !== '/projects' && (
            <div className='absolute inset-0 z-50 bg-background'>
              <main data-id='projects-screen' className='h-full overflow-hidden'>
                <Outlet />
              </main>
            </div>
          )}
        </>
      )}
    </div>
  );
};

ProjectsScreen.displayName = 'ProjectsScreen';

export default ProjectsScreen;
