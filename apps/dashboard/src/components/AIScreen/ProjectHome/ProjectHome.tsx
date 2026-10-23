import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAIChatHandoff } from '../../../routes/AIScreen/useAIChatHandoff';
import { useV2ChatProjects } from '../../../hooks/useAskAISessionsV2';
import { ProjectDialogs } from '../SidebarProjects/ProjectDialogs';
import type { ProjectDialogKind } from '../SidebarProjects/SidebarProjects.types';
import { ProjectHeader } from './ProjectHeader';
import { ProjectInstructionsCard } from './ProjectInstructionsCard';
import { ProjectKnowledgeCard } from './ProjectKnowledgeCard';
import { ProjectChatsCard } from './ProjectChatsCard';

function Centered({ children }: { children: ReactElement | string }): ReactElement {
  return (
    <div className='grid h-full place-items-center px-6 text-center text-sm text-muted-foreground'>
      <div className='max-w-sm'>{children}</div>
    </div>
  );
}

export function ProjectHome(): ReactElement {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();
  const navigate = useNavigate();
  const { onCreateChat } = useAIChatHandoff();
  const { projects, isLoading } = useV2ChatProjects();
  const [dialog, setDialog] = useState<ProjectDialogKind | null>(null);

  const project = projects.find(candidate => candidate.id === projectId) ?? null;

  const chatBase = workspaceId ? `/${workspaceId}/ai/chat` : '/ai/chat';
  // Deleting the project unmounts the dialog that would have redirected, and a
  // delete from the sidebar or another tab never had one. Leave whenever a
  // project we were showing goes away — but not for a URL that never resolved,
  // which should keep saying so.
  const hadProject = useRef(false);
  useEffect(() => {
    if (project) {
      hadProject.current = true;
      return;
    }
    if (hadProject.current) void navigate(`${chatBase}/new`, { replace: true });
  }, [project, chatBase, navigate]);

  if (!projectId) return <Centered>No project selected.</Centered>;
  if (!project) {
    return isLoading ? (
      <Centered>Loading project…</Centered>
    ) : (
      <Centered>This project does not exist, or is no longer shared with you.</Centered>
    );
  }

  const openNewChat = (): void => onCreateChat(project.id);

  return (
    <main className='h-full overflow-y-auto'>
      <div className='mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 pb-12 pt-10 sm:px-8'>
        <ProjectHeader
          project={project}
          chatCount={project.chatCount ?? 0}
          onNewChat={openNewChat}
          onOpenDialog={setDialog}
        />
        <ProjectKnowledgeCard projectId={project.id} />
        <ProjectChatsCard
          projectId={project.id}
          projectName={project.name}
          chatBase={chatBase}
          onNewChat={openNewChat}
        />
        <ProjectInstructionsCard project={project} />
        <div className='h-8' />
      </div>

      <ProjectDialogs kind={dialog} project={project} onClose={() => setDialog(null)} />
    </main>
  );
}
