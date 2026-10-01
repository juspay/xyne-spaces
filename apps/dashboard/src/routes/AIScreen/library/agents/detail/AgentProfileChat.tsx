import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { useReducedMotion } from 'motion/react';
import { AgentBotAvatar } from '@/components/agents/AgentBotAvatar';
import type {
  ConversationHistory,
  Message,
  MessageAttachment,
} from '@/components/Chat/XyneAISidebar/utils/XyneAITypes';
import {
  ThinkingStatus,
  DraftChatComposer,
  UnreadStatus,
} from '@/components/flowUI/nodes/agent/create/DraftChatComposer';
import { useUnreadReplies } from '@/components/flowUI/nodes/agent/create/useUnreadReplies';
import { DraftChatOverlay } from '@/components/flowUI/nodes/agent/create/DraftChatOverlay';
import { DraftChatTranscript } from '@/components/flowUI/nodes/agent/create/DraftChatTranscript';
import { composerPlaceholder } from '@/components/flowUI/nodes/agent/create/draftChatMotion';
import type { DraftChatMessage } from '@/components/flowUI/nodes/agent/create/useDraftChat';
import { useV2SessionInvalidator, useV2SessionsList } from '@/hooks/useAskAISessionsV2';
import { useXyneAIStream } from '@/hooks/useXyneAIStream';
import { EMPTY_DRAFT_CHAT_EXTRAS, type DraftChatExtras } from '@/services/claw/draftChat';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import { fetchV2ConversationMessages } from '@/services/XyneAI/XyneAISessionsV2Service';
import { xyneAIStreamManager } from '@/services/XyneAI/XyneAIStreamManager';
import { newStreamSlotKey } from '@/utils/xyneAIStreamThreadId';

const NO_CHANNELS: string[] = [];
const NO_SESSIONS: ConversationHistory[] = [];

/** The chat's messages in the floating thread's shape. */
export function toThreadMessages(messages: Message[]): DraftChatMessage[] {
  return messages.map(message => {
    const text =
      message.type === 'bot' && message.isStreaming
        ? message.streamingContent || message.content || ''
        : message.content || message.streamingContent || '';
    const files = (message.attachments ?? [])
      .map(file => file.originalFilename ?? file.filename ?? '')
      .filter(name => name.length > 0);
    return {
      id: message.id,
      role: message.type === 'user' ? 'user' : 'assistant',
      content: text,
      ...(files.length > 0 ? { files } : {}),
      ...(message.isStreaming ? { streaming: true } : {}),
      ...(message.errorInfo ? { error: message.errorInfo.message || message.errorInfo.title } : {}),
    };
  });
}

/**
 * Chat with a saved agent from its profile, floating over the bottom of the
 * page: the same composer and card as the create page's test chat, but a real
 * conversation. The header lists your earlier chats with this agent.
 */
export function AgentProfileChat({ agent }: { agent: Agent }): ReactElement {
  const slug = agent.slug;
  const inputId = useId();
  const reduceMotion = useReducedMotion();

  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState('');
  const [streamKey, setStreamKey] = useState(newStreamSlotKey);
  const { submitQuery, abortCurrentRequest } = useXyneAIStream({
    channelIds: NO_CHANNELS,
    conversationId,
    streamSessionKey: streamKey,
    setMessages,
    setConversationId,
    isV2: true,
    agentSlug: slug,
    suppressCompletionToast: true,
    surface: 'page',
  });
  const { data: sessionsData } = useV2SessionsList(slug);
  const sessions = sessionsData ?? NO_SESSIONS;
  const { invalidateSessions } = useV2SessionInvalidator();
  const pending = messages.some(message => message.isStreaming);

  // A chat that just finished shows up in (or moves to the top of) the history.
  const wasPendingRef = useRef(false);
  useEffect(() => {
    if (wasPendingRef.current && !pending) void invalidateSessions(slug);
    wasPendingRef.current = pending;
  }, [pending, invalidateSessions, slug]);

  const [value, setValue] = useState('');
  const [extras, setExtras] = useState<DraftChatExtras>(EMPTY_DRAFT_CHAT_EXTRAS);
  const [sessionOverlay, setSessionOverlay] = useState(false);
  const [active, setActive] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const activeRef = useRef(false);
  activeRef.current = active;
  const loadRequestRef = useRef(0);

  const resetConversation = useCallback((): void => {
    abortCurrentRequest();
    loadRequestRef.current += 1;
    setMessages([]);
    setConversationId('');
    setStreamKey(newStreamSlotKey());
  }, [abortCurrentRequest]);

  const openCard = (): void => {
    setSessionOverlay(true);
    setActive(true);
    setExpanded(true);
  };

  const handleSend = (text: string, sent: DraftChatExtras): void => {
    const attachments: MessageAttachment[] = sent.attachments.map(file => ({
      id: file.id,
      filename: file.fileName,
      originalFilename: file.fileName,
      mimeType: file.mimeType,
      data: file.data,
    }));
    void submitQuery(
      text,
      attachments,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { webSearchEnabled: sent.webSearchEnabled, deepResearchEnabled: sent.deepResearchEnabled },
    );
    setExtras(current => ({ ...current, attachments: [] }));
    openCard();
  };

  const loadSession = async (sessionId: string): Promise<void> => {
    const requestId = ++loadRequestRef.current;
    abortCurrentRequest();
    openCard();
    const live = xyneAIStreamManager.findActiveStreamBySessionId(sessionId, slug);
    if (live && (live.status === 'streaming' || live.status === 'completed')) {
      setStreamKey(sessionId);
      setConversationId(sessionId);
      setMessages(
        live.messages.map(message =>
          live.status === 'completed' && message.isStreaming
            ? { ...message, isStreaming: false }
            : message,
        ),
      );
      return;
    }
    try {
      const fetched = await fetchV2ConversationMessages(sessionId, slug);
      if (loadRequestRef.current !== requestId) return;
      setStreamKey(sessionId);
      setConversationId(sessionId);
      setMessages(fetched.map(message => ({ ...message, isStreaming: false })));
    } catch {
      if (loadRequestRef.current !== requestId) return;
      setMessages([]);
    }
  };

  const handleClose = useCallback((): void => {
    abortCurrentRequest();
    setExpanded(false);
    setActive(false);
  }, [abortCurrentRequest]);
  // A closed chat is finished: once the card has gone, the next message starts
  // a new one (the old one is still in the history).
  const handleExited = useCallback((): void => {
    if (activeRef.current) return;
    resetConversation();
    setSessionOverlay(false);
    setMaximized(false);
  }, [resetConversation]);

  const activeSession = sessions.find(session => session.sessionId === conversationId);
  const firstQuestion = messages.find(message => message.type === 'user')?.content.trim();
  const title = activeSession?.title || firstQuestion || 'New chat';
  const folded = active && !expanded;
  const replying = Boolean(
    [...messages].reverse().find(message => message.type === 'bot')?.streamingContent,
  );
  const unread = useUnreadReplies(
    messages.filter(message => message.type === 'bot' && !message.isStreaming).length,
    expanded,
  );
  const showUnread = folded && !pending && unread > 0;
  const threads = sessions
    .filter(session => session.sessionId)
    .map(session => ({ id: session.sessionId, title: session.title || 'Untitled chat' }));

  return (
    <DraftChatOverlay
      variant={sessionOverlay ? 'session' : 'origin'}
      open={expanded}
      sessionActive={active}
      maximized={maximized}
      reduceMotion={reduceMotion}
      title={title}
      threads={threads}
      activeThreadId={conversationId}
      transcript={
        <DraftChatTranscript
          messages={toThreadMessages(messages)}
          avatar={(size, busy) => (
            <AgentBotAvatar agentKey={agent.id} asleep={!agent.enabled} busy={busy} size={size} />
          )}
          emptyLabel={`Chat with ${agent.name}`}
        />
      }
      onNewChat={() => {
        resetConversation();
        openCard();
      }}
      onSelectThread={id => void loadSession(id)}
      onToggleMaximize={() => setMaximized(current => !current)}
      onCollapse={() => setExpanded(false)}
      onExpand={() => setExpanded(true)}
      onClose={handleClose}
      onExited={handleExited}
    >
      <DraftChatComposer
        inputId={inputId}
        value={value}
        onValueChange={setValue}
        extras={extras}
        onExtrasChange={setExtras}
        placeholder={composerPlaceholder({
          folded,
          pending,
          replying,
          idle: `Ask ${agent.name} anything`,
        })}
        status={
          folded && pending ? (
            <ThinkingStatus
              avatar={<AgentBotAvatar agentKey={agent.id} asleep={!agent.enabled} busy size={22} />}
              replying={replying}
            />
          ) : showUnread ? (
            <UnreadStatus
              avatar={<AgentBotAvatar agentKey={agent.id} asleep={!agent.enabled} size={22} />}
              count={unread}
            />
          ) : undefined
        }
        statusKey={pending ? 'working' : 'unread'}
        statusOnly={showUnread}
        pending={pending}
        disabled={!agent.enabled}
        onSend={handleSend}
        onStop={abortCurrentRequest}
      />
    </DraftChatOverlay>
  );
}
