import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { motion } from 'framer-motion';
import { History, Settings, SquarePen } from 'lucide-react';
import type { ConversationHistory as ConversationHistoryType } from '../../Chat/XyneAISidebar/utils/XyneAITypes';
import { AgentSelector } from '../../Chat/XyneAISidebar/components/AgentSelector';
import { ConversationHistory } from '../../Chat/XyneAISidebar/components/ConversationHistory';
import { contentGroupVariants } from '../claw.motion';

import { useClawConversation } from '../ClawConversationContext';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { ClawSettings } from './ClawSettings';

export interface ClawChatProps {
  onRequestClose?: () => void;
}

function ClawChat({ onRequestClose }: ClawChatProps = {}): ReactElement {
  const {
    messages,
    isStreaming,
    conversationId,
    selectedAgentSlug,
    agents,
    sessions,
    sessionsLoading,
    loadingSessionId,
    submitQuery,
    abortCurrentRequest,
    selectAgent,
    newChat,
    loadConversation,
    deleteConversation,
    refetchSessions,
  } = useClawConversation();

  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (showHistory) refetchSessions();
  }, [showHistory, refetchSessions]);

  const handleRetry = useCallback(() => {
    const lastUserMessage = [...messages].reverse().find(m => m.type === 'user');
    if (!lastUserMessage) return;
    submitQuery(lastUserMessage.content);
  }, [messages, submitQuery]);

  const handleLoadConversation = useCallback(
    async (conversation: ConversationHistoryType): Promise<void> => {
      if (await loadConversation(conversation)) setShowHistory(false);
    },
    [loadConversation],
  );

  const handleToggleStar = useCallback(async (): Promise<void> => {}, []);
  const handleRenameConversation = useCallback(async (): Promise<void> => {}, []);

  const streamingSessionIds = useMemo(
    () => (isStreaming && conversationId ? [conversationId] : []),
    [isStreaming, conversationId],
  );

  useEffect(() => {
    if (!onRequestClose) return;
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onRequestClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return (): void => window.removeEventListener('keydown', handleKeyDown);
  }, [onRequestClose]);

  return (
    <div className='flex h-full w-full min-h-0 flex-col'>
      <motion.div
        variants={contentGroupVariants}
        className='shrink-0 border-b border-border px-2 py-1.5'
      >
        <div className='flex items-center justify-between gap-2'>
          <AgentSelector
            selectedAgentSlug={selectedAgentSlug}
            agents={agents}
            onSelect={selectAgent}
            disabled={isStreaming}
            compact
          />
          <div className='flex shrink-0 items-center gap-1'>
            <button
              type='button'
              onClick={newChat}
              aria-label='New chat'
              title='New chat'
              data-track-category='CLAW_CHAT'
              data-track-name='NEW_CHAT'
              className='flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
            >
              <SquarePen className='size-4' />
            </button>
            <button
              type='button'
              onClick={() => {
                setShowSettings(false);
                setShowHistory(prev => !prev);
              }}
              aria-label='Conversation history'
              title='Conversation history'
              data-track-category='CLAW_CHAT'
              data-track-name='TOGGLE_HISTORY'
              className='flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
            >
              <History className='size-4' />
            </button>
            <button
              type='button'
              onClick={() => {
                setShowHistory(false);
                setShowSettings(prev => !prev);
              }}
              aria-label='Claw settings'
              title='Settings'
              data-track-category='CLAW_CHAT'
              data-track-name='TOGGLE_SETTINGS'
              className='flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
            >
              <Settings className='size-4' />
            </button>
          </div>
        </div>
      </motion.div>
      <motion.div variants={contentGroupVariants} className='flex min-h-0 flex-1 flex-col'>
        {showSettings ? (
          <ClawSettings onBack={() => setShowSettings(false)} />
        ) : showHistory ? (
          <ConversationHistory
            conversations={sessions}
            conversationId={conversationId}
            loadingSessionId={loadingSessionId}
            streamingSessionIds={streamingSessionIds}
            isLoading={sessionsLoading && sessions.length === 0}
            onBack={() => setShowHistory(false)}
            onClose={() => setShowHistory(false)}
            onLoadConversation={conversation => {
              void handleLoadConversation(conversation);
            }}
            onToggleStar={handleToggleStar}
            onDeleteConversation={deleteConversation}
            onRenameConversation={handleRenameConversation}
            showStarRenameActions={false}
            selectedAgentSlug={selectedAgentSlug}
            agents={agents}
            onSelectAgent={selectAgent}
            agentSelectorDisabled={isStreaming}
          />
        ) : (
          <MessageList messages={messages} onRetry={handleRetry} />
        )}
      </motion.div>

      {!showHistory && !showSettings && (
        <motion.div variants={contentGroupVariants} className='shrink-0'>
          <Composer isStreaming={isStreaming} onSend={submitQuery} onStop={abortCurrentRequest} />
        </motion.div>
      )}
    </div>
  );
}

export { ClawChat };
