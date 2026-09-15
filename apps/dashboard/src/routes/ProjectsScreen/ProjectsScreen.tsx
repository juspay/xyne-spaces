import { ReactElement, useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { ResizableGroup, Panel, Separator } from '../../components/ui/Resizable/Resizable';
import {
  PROJECTS_SIDEBAR_DEFAULT_WIDTH,
  PROJECTS_SIDEBAR_MAX_WIDTH,
  PROJECTS_SIDEBAR_MIN_WIDTH,
} from './projectsSidebarWidth';
import { ProjectSidebar } from '../../components/Project';
import { queries } from '../../zero/queries';
import { usePlatform } from '../../hooks/usePlatform';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { useUsers } from '../../hooks/useUsers';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useUserGroups } from '../../hooks/useUserGroup';

const ProjectsScreen = (): ReactElement => {
  const location = useLocation();
  const { workspaceId, ticketId } = useParams<{ workspaceId?: string; ticketId?: string }>();
  const { isMobile } = usePlatform();
  const { isWideScreen, containerRef } = useResizablePanel({ isMobile });

  // Fetch all projects using zero
  const [projects] = useCachedQuery(queries.getAllProjects());
  const users = useUsers();
  const userGroups = useUserGroups();

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
    if (!ticketId) {
      localStorage.setItem(lastTicketsPathKey, `${location.pathname}${location.search}`);
    }
  }, [redirectTo, ticketId, lastTicketsPathKey, location.pathname, location.search]);

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
            defaultSize={PROJECTS_SIDEBAR_DEFAULT_WIDTH}
            minSize={PROJECTS_SIDEBAR_MIN_WIDTH}
            maxSize={PROJECTS_SIDEBAR_MAX_WIDTH}
            groupResizeBehavior='preserve-pixel-size'
          >
            <aside className='w-full h-full'>
              <ProjectSidebar projects={projects} persons={users} userGroups={userGroups} />
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
                <Outlet />
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
