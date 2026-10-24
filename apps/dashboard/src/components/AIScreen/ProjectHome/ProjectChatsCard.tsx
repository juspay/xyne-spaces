import { type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { PencilEditBox } from '@xyne/icons';
import { useV2SessionsList } from '../../../hooks/useAskAISessionsV2';
import { ConversationRowContent } from '../ConversationAgents';
import { SECTION_HEADING_CLASS } from './projectHome.utils';

export function ProjectChatsCard({
  projectId,
  projectName,
  chatBase,
  onNewChat,
}: {
  projectId: string;
  projectName: string;
  chatBase: string;
  onNewChat: () => void;
}): ReactElement {
  const { conversations, isLoading } = useV2SessionsList({ projectId });

  return (
    <section>
      <h2 className={SECTION_HEADING_CLASS}>Chats</h2>

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
            <PencilEditBox size={14} aria-hidden />
            New chat in {projectName}
          </button>
        </div>
      ) : (
        <ul className='mt-2 -mx-2'>
          {conversations.map(conversation => (
            <li key={conversation.id}>
              <Link
                to={`${chatBase}/${conversation.sessionId}`}
                className='flex min-h-[46px] items-center rounded-[10px] px-2.5 py-1.5 text-sm transition-colors hover:bg-secondary/40'
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
