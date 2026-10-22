import type { ReactElement } from 'react';
import { useV2SessionsList } from '../../../hooks/useAskAISessionsV2';
import type { ProjectChatsProps } from './SidebarProjects.types';

export function ProjectChats({
  projectId,
  agentFilter,
  isExpanded,
  renderSessions,
}: ProjectChatsProps): ReactElement | null {
  const { conversations, isLoading } = useV2SessionsList({
    agentSlug: agentFilter,
    projectId,
    enabled: isExpanded,
    refetchOnMount: false,
  });

  const unpinned = conversations.filter(conversation => !conversation.isStarred);

  if (!isExpanded) return null;

  if (isLoading) {
    return (
      <p className='px-3 py-2 pl-9 text-xs text-muted-foreground' role='status'>
        Loading chats…
      </p>
    );
  }

  if (unpinned.length === 0) {
    return (
      <p className='px-3 py-2 pl-9 text-xs text-muted-foreground'>
        {conversations.length === 0
          ? 'No chats in this project yet.'
          : 'Every chat here is pinned — find them under Pinned.'}
      </p>
    );
  }

  return <div className='pl-4'>{renderSessions(unpinned)}</div>;
}
