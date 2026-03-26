import { ReactElement } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { ProjectSidebar } from '../../components/Project';
import { queries } from '../../zero/queries';
import { usePlatform } from '../../hooks/usePlatform';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { useUsers } from '../../hooks/useUsers';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useUserGroups } from '../../hooks/useUserGroup';

const ProjectsScreen = (): ReactElement => {
  const location = useLocation();
  const { isMobile } = usePlatform();
  const { isWideScreen, containerRef } = useResizablePanel({ isMobile });

  // Fetch all projects using zero
  const [projects] = useCachedQuery(queries.getAllProjects());
  const users = useUsers();
  const userGroups = useUserGroups();

  return (
    <div
      ref={containerRef}
      className='h-full relative bg-background md:rounded-2xl overflow-hidden shadow-md'
      data-component='ProjectsScreen'
    >
      {isWideScreen ? (
        <PanelGroup
          direction='horizontal'
          className='flex align-top h-full'
          autoSaveId='projects-screen-resize'
        >
          {/* LEFT PANEL (Sidebar) */}
          <Panel defaultSize={20} minSize={15} maxSize={30}>
            <aside className='w-full h-full'>
              <ProjectSidebar
                projects={projects}
                persons={users}
                userGroups={userGroups}
                onClose={() => {}}
              />
            </aside>
          </Panel>

          {/* RESIZE HANDLE */}
          <PanelResizeHandle className='w-1 hover:bg-blue-50 active:bg-blue-100 transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
            <div id='panel-resize-divider' className='w-[1px] h-full bg-border'></div>
          </PanelResizeHandle>

          {/* RIGHT PANEL (Content View) */}
          <Panel>
            <main data-id='projects-content-view' className='flex-1 h-full overflow-hidden'>
              <Outlet />
            </main>
          </Panel>
        </PanelGroup>
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
