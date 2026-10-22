import { useState, type ReactElement } from 'react';
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

/**
 * A project's own page: what it tells the assistant, what it knows, what is in
 * it.
 *
 * The project is read from the cached list rather than fetched by id. The
 * sidebar has already loaded it, so a navigation from there renders at once
 * instead of flashing a spinner over data the app is holding.
 */
export function ProjectHome(): ReactElement {
  // Every AI route is workspace-scoped, so the id has to be carried into any
  // link this page builds rather than assuming a bare /ai path.
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();
  const navigate = useNavigate();
  const { onCreateChat } = useAIChatHandoff();
  const { projects, isLoading } = useV2ChatProjects();
  const [dialog, setDialog] = useState<ProjectDialogKind | null>(null);

  const project = projects.find(candidate => candidate.id === projectId) ?? null;

  if (!projectId) return <Centered>No project selected.</Centered>;
  // Only an empty cache is "loading". A loaded list that does not hold this id
  // means the project is gone or was never the caller's, which is a different
  // thing to say.
  if (!project) {
    return isLoading ? (
      <Centered>Loading project…</Centered>
    ) : (
      <Centered>This project does not exist, or is no longer shared with you.</Centered>
    );
  }

  const chatBase = workspaceId ? `/${workspaceId}/ai/chat` : '/ai/chat';

  // The same handoff the sidebar and daily brief use, so a chat started here
  // is filed exactly as one started from a project row.
  const openNewChat = (): void => onCreateChat(project.id);

  return (
    <main className='h-full overflow-y-auto'>
      <div className='mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6'>
        <ProjectHeader
          project={project}
          chatCount={project.chatCount ?? 0}
          onNewChat={openNewChat}
          onOpenDialog={setDialog}
        />
        <ProjectInstructionsCard project={project} />
        <ProjectKnowledgeCard projectId={project.id} />
        <ProjectChatsCard
          projectId={project.id}
          projectName={project.name}
          chatBase={chatBase}
          onNewChat={openNewChat}
        />
        {/* Chromium gives no reachable space to padding-bottom on a scroll
            container, so the last card would sit flush against the edge. */}
        <div className='h-8' />
      </div>

      <ProjectDialogs
        kind={dialog}
        project={project}
        onClose={() => {
          // A deleted project has nothing left to show, so the page steps back
          // to the chat screen rather than rendering its own "does not exist".
          const wasDelete = dialog === 'delete';
          setDialog(null);
          if (wasDelete && !projects.some(candidate => candidate.id === project.id)) {
            void navigate(`${chatBase}/new`);
          }
        }}
      />
    </main>
  );
}
