import { type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { ChatPlus } from '@xyne/icons';
import { useV2SessionsList } from '../../../hooks/useAskAISessionsV2';
import { ConversationRowContent } from '../ConversationAgents';

/**
 * The chats filed under this project.
 *
 * Pinned chats are kept here, unlike the sidebar: the sidebar lists them
 * separately under Pinned, so filtering them out there avoids showing one chat
 * twice. This page is the project's whole contents, and a pinned chat missing
 * from it would read as having left the project.
 */
export function ProjectChatsCard({
  projectId,
  projectName,
  chatBase,
  onNewChat,
}: {
  projectId: string;
  projectName: string;
  /** Workspace-scoped `/:workspaceId/ai/chat`; every AI route sits under it. */
  chatBase: string;
  onNewChat: () => void;
}): ReactElement {
  const { conversations, isLoading } = useV2SessionsList({ projectId });

  return (
    <section className='rounded-xl border border-border bg-card p-4 sm:p-5'>
      <div className='flex items-baseline justify-between gap-3'>
        <h2 className='text-sm font-medium text-foreground'>Chats</h2>
        {conversations.length > 0 && (
          <span className='text-xs text-muted-foreground'>{conversations.length}</span>
        )}
      </div>

      {isLoading ? (
        <p className='mt-3 text-xs text-muted-foreground'>Loading…</p>
      ) : conversations.length === 0 ? (
        <div className='mt-3'>
          <p className='text-xs text-muted-foreground'>No chats in this project yet.</p>
          <button
            type='button'
            onClick={onNewChat}
            className='mt-3 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-secondary/60'
            data-track-category='XyneAI'
            data-track-name='NEW_CHAT_IN_PROJECT'
            data-track-metadata={JSON.stringify({ surface: 'project-home-empty', projectId })}
          >
            <ChatPlus size={14} aria-hidden />
            New chat in {projectName}
          </button>
        </div>
      ) : (
        <ul className='mt-2 -mx-2'>
          {conversations.map(conversation => (
            <li key={conversation.id}>
              <Link
                to={`${chatBase}/${conversation.sessionId}`}
                className='flex min-h-[46px] items-center rounded-[10px] px-2.5 py-1.5 transition-colors hover:bg-secondary/40'
                data-track-category='XyneAI'
                data-track-name='OPEN_PROJECT_CHAT'
              >
                <ConversationRowContent
                  conversation={conversation}
                  title={<span className='block truncate'>{conversation.title}</span>}
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
