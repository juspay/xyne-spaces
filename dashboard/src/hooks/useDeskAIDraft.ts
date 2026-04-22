import { useState, useCallback, useRef, useEffect } from 'react';
import { xyneAIStreamManager, type StreamState } from '../services/XyneAI';
import {
  fetchSessionsByConversationId,
  fetchSessionDetail,
} from '../services/XyneAI/XyneAISessionsService';
import type { Message } from '../components/Chat/XyneAISidebar/utils/XyneAITypes';

interface UseDeskAIDraftOptions {
  channelId: string;
  conversationId: string;
  ticketId?: string | null;
}

export interface UseDeskAIDraftReturn {
  draftContent: string;
  isStreaming: boolean;
  isDraftActive: boolean;
  triggerDraft: () => void;
  refineDraft: (instruction: string) => void;
  acceptDraft: () => string;
  rejectDraft: () => void;
}

const latestBotContent = (messages: Message[]): string | null => {
  const bot = [...messages].reverse().find(m => m.type === 'bot');
  if (!bot) return null;
  if (bot.parsedContent?.summary) return bot.parsedContent.summary;
  const stream = bot.streamingContent || bot.content || '';
  const head = stream.trimStart();
  if (head.startsWith('{') || head.startsWith('[')) return null;
  return stream || null;
};

// Prior messages are chained via parentId — without a chain, every parentless
// draft turn becomes a sibling at BRANCH_ROOT_KEY and the sidebar renders
// branch arrows the next time any turn is added.
const loadPriorMessages = async (
  threadId: string,
  sessionId: string | null,
): Promise<Message[]> => {
  const active = xyneAIStreamManager.getActiveStream(threadId);
  if (active?.messages.length) return active.messages;
  if (!sessionId) return [];
  try {
    const detail = await fetchSessionDetail(sessionId);
    const chain: Message[] = [];
    for (const m of detail.messages) {
      const prev = chain[chain.length - 1];
      chain.push({
        id: m.id,
        type: m.type,
        content: m.content,
        timestamp: new Date(m.timestamp),
        isStreaming: false,
        ...(prev && { parentId: prev.id }),
      });
    }
    return chain;
  } catch {
    return [];
  }
};

export function useDeskAIDraft({
  channelId,
  conversationId,
  ticketId,
}: UseDeskAIDraftOptions): UseDeskAIDraftReturn {
  const [draftContent, setDraftContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isDraftActive, setIsDraftActive] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const ourStreamIdRef = useRef<string | null>(null);

  const threadId = channelId && conversationId ? `${channelId}_${conversationId}` : '';

  useEffect(() => {
    setDraftContent('');
    setIsStreaming(false);
    setIsDraftActive(false);
    sessionIdRef.current = null;
    ourStreamIdRef.current = null;

    if (!conversationId) return;
    let cancelled = false;
    fetchSessionsByConversationId(conversationId)
      .then(sessions => {
        if (cancelled) return;
        const first = sessions[0];
        if (first && !sessionIdRef.current) {
          sessionIdRef.current = first.sessionId;
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // Only mirror content/status for streams we started — sidebar streams share
  // the threadId but their output belongs in the sidebar, not the draft card.
  useEffect(() => {
    if (!threadId) return;
    return xyneAIStreamManager.subscribe((state: StreamState) => {
      if (state.threadId !== threadId) return;
      if (state.sessionId && state.sessionId !== sessionIdRef.current) {
        sessionIdRef.current = state.sessionId;
      }
      if (state.streamId !== ourStreamIdRef.current) return;
      const content = latestBotContent(state.messages);
      if (content !== null) setDraftContent(content);
      setIsStreaming(state.status === 'streaming');
    });
  }, [threadId]);

  const submit = useCallback(
    async (query: string, displayContent: string) => {
      if (!threadId || !channelId || !conversationId) return;

      setIsDraftActive(true);
      setIsStreaming(true);
      setDraftContent('');

      const userMessageId = `user-${Date.now()}`;
      const prior = await loadPriorMessages(threadId, sessionIdRef.current);
      const lastPriorId = prior[prior.length - 1]?.id;

      try {
        ourStreamIdRef.current = await xyneAIStreamManager.startStream(
          threadId,
          {
            query,
            channelIds: [],
            conversationId: sessionIdRef.current || '',
            threadConversationId: conversationId,
            webSearchEnabled: true,
            deepResearchEnabled: false,
            researchContext: null,
            attachments: [],
            ...(ticketId && { ticketIds: [ticketId] }),
            localUserMessageId: userMessageId,
            suppressCompletionToast: true,
            draftMode: true,
          },
          [
            ...prior,
            {
              id: userMessageId,
              type: 'user',
              content: displayContent,
              timestamp: new Date(),
              ...(lastPriorId && { parentId: lastPriorId }),
            },
            {
              id: `bot-${Date.now()}`,
              type: 'bot',
              content: '',
              timestamp: new Date(),
              isStreaming: true,
              parentId: userMessageId,
            },
          ],
        );
      } catch (error) {
        console.error('[useDeskAIDraft] startStream failed:', error);
        setIsStreaming(false);
      }
    },
    [threadId, channelId, conversationId, ticketId],
  );

  const triggerDraft = useCallback(() => {
    void submit('Draft a reply for this ticket.', 'Draft a reply');
  }, [submit]);

  const refineDraft = useCallback(
    (instruction: string) => {
      const query = draftContent
        ? `Refine this draft: ${instruction}\n\nCurrent draft:\n\n${draftContent}`
        : instruction;
      void submit(query, instruction);
    },
    [submit, draftContent],
  );

  const acceptDraft = useCallback(() => {
    setIsDraftActive(false);
    ourStreamIdRef.current = null;
    return draftContent;
  }, [draftContent]);

  const rejectDraft = useCallback(() => {
    if (threadId && ourStreamIdRef.current) {
      xyneAIStreamManager.abortStreamByThread(threadId);
    }
    ourStreamIdRef.current = null;
    setIsDraftActive(false);
    setDraftContent('');
    setIsStreaming(false);
  }, [threadId]);

  return {
    draftContent,
    isStreaming,
    isDraftActive,
    triggerDraft,
    refineDraft,
    acceptDraft,
    rejectDraft,
  };
}
