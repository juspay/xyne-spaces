import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronBigDown, FolderPlus } from '@xyne/icons';
import { cn } from '../../../utils/classNames';
import { useV2ChatProjects } from '../../../hooks/useAskAISessionsV2';
import type { ChatProject } from '../../../services/XyneAI/XyneAISessionsV2Service';
import { ProjectChats } from './ProjectChats';
import { ProjectDialogs } from './ProjectDialogs';
import { ProjectRow } from './ProjectRow';
import type { ProjectDialogKind, SidebarProjectsProps } from './SidebarProjects.types';
import { readExpandedProjectIds, writeExpandedProjectIds } from './SidebarProjects.utils';

export function SidebarProjects({
  agentFilter,
  renderSessions,
  userId,
  onCreateChatInProject,
}: SidebarProjectsProps): ReactElement {
  const { projects } = useV2ChatProjects();
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const [sectionOpen, setSectionOpen] = useState(true);
  const [expandedIds, setExpandedIds] = useState<string[]>(() => readExpandedProjectIds(userId));
  const [dialogKind, setDialogKind] = useState<ProjectDialogKind | null>(null);
  const [dialogProject, setDialogProject] = useState<ChatProject | null>(null);

  useEffect(() => {
    setExpandedIds(readExpandedProjectIds(userId));
  }, [userId]);

  useEffect(() => {
    if (projects.length === 0) return;
    writeExpandedProjectIds(
      userId,
      expandedIds.filter(id => projects.some(project => project.id === id)),
    );
  }, [userId, expandedIds, projects]);

  const onOpenProject = useCallback(
    (projectId: string): void => {
      const base = workspaceId ? `/${workspaceId}/ai` : '/ai';
      void navigate(`${base}/projects/${encodeURIComponent(projectId)}`);
    },
    [navigate, workspaceId],
  );

  const toggleProject = useCallback((projectId: string): void => {
    setExpandedIds(previous =>
      previous.includes(projectId)
        ? previous.filter(id => id !== projectId)
        : [...previous, projectId],
    );
  }, []);

  const openDialog = (kind: ProjectDialogKind, project: ChatProject | null): void => {
    setDialogProject(project);
    setDialogKind(kind);
  };

  const closeDialog = (): void => {
    setDialogKind(null);
    setDialogProject(null);
  };

  return (
    <div className='flex max-h-[40%] shrink-0 flex-col' data-testid='sidebar-projects'>
      <div className='group flex h-7 shrink-0 items-center justify-between gap-2 rounded-[10px] px-3'>
        <button
          type='button'
          onClick={() => setSectionOpen(previous => !previous)}
          aria-expanded={sectionOpen}
          className='flex min-w-0 flex-1 items-center gap-1 text-xs font-medium capitalize tracking-[0.48px] text-sidebar-foreground transition-colors hover:text-sidebar-accent-foreground'
          data-track-category='XyneAI'
          data-track-name='TOGGLE_PROJECTS_SECTION'
        >
          <span className='block truncate text-left'>Projects</span>
          <ChevronBigDown
            size={12}
            className={cn(
              'shrink-0 transition-transform duration-200',
              !sectionOpen && '-rotate-90',
            )}
            aria-hidden
          />
        </button>
        <button
          type='button'
          onClick={() => openDialog('create', null)}
          aria-label='New project'
          title='New project'
          className='flex shrink-0 items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
          data-track-category='XyneAI'
          data-track-name='CREATE_CHAT_PROJECT'
        >
          <FolderPlus size={14} className='shrink-0' aria-hidden />
        </button>
      </div>

      {sectionOpen && projects.length === 0 && (
        <p className='px-3 pb-1 pt-0.5 text-xs text-muted-foreground'>
          No projects yet. Create one to group related chats.
        </p>
      )}

      {sectionOpen && projects.length > 0 && (
        <div className='min-h-0 overflow-y-auto no-scrollbar'>
          {projects.map(project => {
            const isExpanded = expandedIds.includes(project.id);
            return (
              <div key={project.id}>
                <ProjectRow
                  project={project}
                  isExpanded={isExpanded}
                  onToggle={() => toggleProject(project.id)}
                  onOpen={() => onOpenProject(project.id)}
                  onRename={() => openDialog('rename', project)}
                  onDelete={() => openDialog('delete', project)}
                  onNewChat={() => onCreateChatInProject(project.id)}
                />
                <ProjectChats
                  projectId={project.id}
                  agentFilter={agentFilter}
                  isExpanded={isExpanded}
                  renderSessions={renderSessions}
                />
              </div>
            );
          })}
        </div>
      )}

      <ProjectDialogs kind={dialogKind} project={dialogProject} onClose={closeDialog} />
    </div>
  );
}
