import { logger, Event as LogEvent } from '../../utils/logger';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useXyneAIStream } from '../../hooks/useXyneAIStream';
import { newStreamSlotKey } from '../../utils/xyneAIStreamThreadId';
import { CLAW_AGENTS_STALE_TIME_MS } from './claw.constants';
import { useV2SessionInvalidator } from '../../hooks/useAskAISessionsV2';
import {
  fetchV2ConversationMessages,
  deleteV2Conversation,
} from '../../services/XyneAI/XyneAISessionsV2Service';
import { xyneAIStreamManager } from '../../services/XyneAI/XyneAIStreamManager';
import {
  fetchAccessibleClawAgents,
  type AccessibleClawAgent,
} from '../../services/clawAgentListService';
import type {
  Message,
  ConversationHistory,
  PendingActionResolution,
} from '../Chat/XyneAISidebar/utils/XyneAITypes';
import { resolveMessagePendingAction } from './claw.utils';

const EMPTY_CHANNEL_IDS: string[] = [];
const EMPTY_AGENTS: AccessibleClawAgent[] = [];

export interface ClawConversationValue {
  messages: Message[];
  isStreaming: boolean;
  conversationId: string;
  selectedAgentSlug: string | null;
  agents: AccessibleClawAgent[];
  loadingSessionId: string | null;
  submitQuery: (text: string) => void;
  abortCurrentRequest: () => void;
  selectAgent: (slug: string | null) => void;
  newChat: () => void;
  loadConversation: (conversation: ConversationHistory) => Promise<boolean>;
  deleteConversation: (conversation: ConversationHistory) => Promise<void>;
  resolvePendingAction: (
    messageId: string,
    actionIndex: number,
    resolution: PendingActionResolution,
  ) => void;
}

export interface ClawTabStatus {
  isStreaming: boolean;
  hasUnseenAnswer: boolean;
  hasError: boolean;
}

const ClawConversationContext = createContext<ClawConversationValue | null>(null);
const ClawTabStatusContext = createContext<ClawTabStatus>({
  isStreaming: false,
  hasUnseenAnswer: false,
  hasError: false,
});

export function useClawConversation(): ClawConversationValue {
  const value = useContext(ClawConversationContext);
  if (!value) throw new Error('useClawConversation must be used within ClawConversationProvider');
  return value;
}

export function useClawTabStatus(): ClawTabStatus {
  return useContext(ClawTabStatusContext);
}

interface ClawConversationProviderProps {
  isOpen: boolean;
  children: ReactNode;
}

export function ClawConversationProvider({
  isOpen,
  children,
}: ClawConversationProviderProps): ReactElement {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState('');
  const [streamThreadKey, setStreamThreadKey] = useState(newStreamSlotKey);
  const [selectedAgentSlug, setSelectedAgentSlug] = useState<string | null>(null);
  const historyAgentSlug = selectedAgentSlug ?? 'ask-ai';
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);

  const loadRequestRef = useRef(0);

  const { data: agentsData } = useQuery({
    queryKey: ['accessible-claw-agents'],
    queryFn: fetchAccessibleClawAgents,
    staleTime: CLAW_AGENTS_STALE_TIME_MS,
  });
  const agents = agentsData ?? EMPTY_AGENTS;

  const { invalidateSessions } = useV2SessionInvalidator();

  const { submitQuery: submitQueryAsync, abortCurrentRequest } = useXyneAIStream({
    channelIds: EMPTY_CHANNEL_IDS,
    conversationId,
    streamSessionKey: streamThreadKey,
    setMessages,
    setConversationId,

    isV2: true,
    agentSlug: selectedAgentSlug,
  });

  const submitQuery = useCallback(
    (text: string) => {
      void submitQueryAsync(text);
    },
    [submitQueryAsync],
  );

  const isStreaming = useMemo(() => messages.some(m => m.isStreaming), [messages]);
  const hasError = useMemo(
    () => !![...messages].reverse().find(message => message.type === 'bot')?.errorInfo,
    [messages],
  );

  const [hasUnseenAnswer, setHasUnseenAnswer] = useState(false);
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming && !isOpen) setHasUnseenAnswer(true);
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, isOpen]);
  useEffect(() => {
    if (isOpen) setHasUnseenAnswer(false);
  }, [isOpen]);

  const resetConversation = useCallback(() => {
    abortCurrentRequest();

    loadRequestRef.current += 1;
    setMessages([]);
    setConversationId('');
    setStreamThreadKey(newStreamSlotKey());

    wasStreamingRef.current = false;
    setHasUnseenAnswer(false);
  }, [abortCurrentRequest]);

  const newChat = useCallback(() => {
    resetConversation();
  }, [resetConversation]);

  const selectAgent = useCallback(
    (slug: string | null) => {
      if (slug === selectedAgentSlug) return;
      if (isStreaming) return;

      // In an open conversation this is a mid-conversation switch: the chat
      // stays and the next turn goes to the new agent in the same
      // conversation. Only an empty overlay starts fresh.
      if (!conversationId) resetConversation();
      setSelectedAgentSlug(slug);
    },
    [selectedAgentSlug, isStreaming, resetConversation, conversationId],
  );

  const loadConversation = useCallback(
    async (conversation: ConversationHistory): Promise<boolean> => {
      const requestId = ++loadRequestRef.current;
      setLoadingSessionId(conversation.sessionId);
      // The history spans every agent: open the chat with the agent it was
      // last with, and keep talking to that agent from here.
      const rowAgentSlug = conversation.agentSlug ?? historyAgentSlug;
      setSelectedAgentSlug(rowAgentSlug === 'ask-ai' ? null : rowAgentSlug);
      try {
        const live = xyneAIStreamManager.findActiveStreamBySessionId(
          conversation.sessionId,
          rowAgentSlug,
        );
        if (live && (live.status === 'streaming' || live.status === 'completed')) {
          if (loadRequestRef.current !== requestId) return false;
          setStreamThreadKey(conversation.sessionId);
          setConversationId(conversation.sessionId);
          setMessages(
            live.messages.map(m =>
              live.status === 'completed' && m.isStreaming ? { ...m, isStreaming: false } : m,
            ),
          );
          wasStreamingRef.current = false;
          setHasUnseenAnswer(false);
          return true;
        }
        const fetched = await fetchV2ConversationMessages(conversation.sessionId, rowAgentSlug);

        if (loadRequestRef.current !== requestId) return false;
        setStreamThreadKey(conversation.sessionId);
        setConversationId(conversation.sessionId);
        setMessages(fetched.map(m => ({ ...m, isStreaming: false })));

        wasStreamingRef.current = false;
        setHasUnseenAnswer(false);
        return true;
      } catch (error) {
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('[Claw] Failed to load conversation'),
          error: error,
        });
        return false;
      } finally {
        if (loadRequestRef.current === requestId) setLoadingSessionId(null);
      }
    },
    [historyAgentSlug],
  );

  const deleteConversation = useCallback(
    async (conversation: ConversationHistory): Promise<void> => {
      const rowAgentSlug = conversation.agentSlug ?? historyAgentSlug;
      await deleteV2Conversation(conversation.sessionId, rowAgentSlug);
      if (conversation.sessionId === conversationId) resetConversation();
      invalidateSessions();
    },
    [historyAgentSlug, conversationId, resetConversation, invalidateSessions],
  );

  const resolvePendingAction = useCallback(
    (messageId: string, actionIndex: number, resolution: PendingActionResolution) => {
      setMessages(current =>
        resolveMessagePendingAction(current, messageId, actionIndex, resolution),
      );
    },
    [],
  );

  const value = useMemo<ClawConversationValue>(
    () => ({
      messages,
      isStreaming,
      conversationId,
      selectedAgentSlug,
      agents,
      loadingSessionId,
      submitQuery,
      abortCurrentRequest,
      selectAgent,
      newChat,
      loadConversation,
      deleteConversation,
      resolvePendingAction,
    }),
    [
      messages,
      isStreaming,
      conversationId,
      selectedAgentSlug,
      agents,
      loadingSessionId,
      submitQuery,
      abortCurrentRequest,
      selectAgent,
      newChat,
      loadConversation,
      deleteConversation,
      resolvePendingAction,
    ],
  );

  const tabStatus = useMemo<ClawTabStatus>(
    () => ({ isStreaming, hasUnseenAnswer, hasError }),
    [isStreaming, hasUnseenAnswer, hasError],
  );

  return (
    <ClawConversationContext.Provider value={value}>
      <ClawTabStatusContext.Provider value={tabStatus}>{children}</ClawTabStatusContext.Provider>
    </ClawConversationContext.Provider>
  );
}
