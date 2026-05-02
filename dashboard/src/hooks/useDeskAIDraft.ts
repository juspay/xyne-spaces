import { useState, useCallback, useRef, useEffect } from 'react';
import { xyneAIStreamManager, type StreamState } from '../services/XyneAI';
import {
  fetchSessionsByConversationId,
  fetchSessionDetail,
} from '../services/XyneAI/XyneAISessionsService';
import type { Message } from '../components/Chat/XyneAISidebar/utils/XyneAITypes';
import { logger, Event } from '../utils/logger';

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
  rephraseDraft: (instruction: string, sourceText: string) => void;
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
  const storageKey = threadId ? `xd-ai-draft:${threadId}` : '';

  const writeStorage = useCallback(
    (content: string): void => {
      if (!storageKey || typeof window === 'undefined') return;
      try {
        localStorage.setItem(storageKey, JSON.stringify({ content }));
      } catch {
        /* quota / private mode — non-fatal */
      }
    },
    [storageKey],
  );
  const clearStorage = useCallback((): void => {
    if (!storageKey || typeof window === 'undefined') return;
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* non-fatal */
    }
  }, [storageKey]);

  useEffect(() => {
    setDraftContent('');
    setIsStreaming(false);
    setIsDraftActive(false);
    sessionIdRef.current = null;
    ourStreamIdRef.current = null;

    if (!conversationId) return;

    if (threadId) {
      const active = xyneAIStreamManager.getActiveStream(threadId);
      if (active) {
        ourStreamIdRef.current = active.streamId;
        if (active.sessionId) sessionIdRef.current = active.sessionId;
        setIsDraftActive(true);
        setIsStreaming(active.status === 'streaming');
        const content = latestBotContent(active.messages);
        if (content !== null) setDraftContent(content);
      }
    }

    if (storageKey && typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as { content?: string };
          if (parsed?.content) {
            setDraftContent(parsed.content);
            setIsDraftActive(true);
          }
        }
      } catch {
        /* ignore corrupt entries */
      }
    }

    let cancelled = false;
    fetchSessionsByConversationId(conversationId)
      .then(sessions => {
        if (cancelled) return;
        const first = sessions[0];
        if (first && !sessionIdRef.current) {
          sessionIdRef.current = first.sessionId;
        }
      })
      .catch((err: unknown) => {
        logger.warn(Event.DESK_AI_DRAFT_SESSIONS_FETCH_FAILED, {
          conversationId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, storageKey]);

  useEffect(() => {
    if (!isDraftActive) return;
    if (!draftContent) return;
    writeStorage(draftContent);
  }, [draftContent, isDraftActive, writeStorage]);

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
        logger.error(Event.DESK_AI_DRAFT_STREAM_FAILED, {
          threadId,
          conversationId,
          error: error instanceof Error ? error.message : String(error),
        });
        setIsStreaming(false);
      }
    },
    [threadId, channelId, conversationId, ticketId],
  );

  const triggerDraft = useCallback(() => {
    void submit('Draft a reply for this ticket.', 'Draft a reply');
  }, [submit]);

  const rephraseDraft = useCallback(
    (instruction: string, sourceText: string) => {
      const trimmedSource = sourceText.trim();
      const trimmedInstruction = instruction.trim();
      const parts = ['Draft a reply for this ticket.'];
      if (trimmedSource) {
        parts.push(
          `The user has already started writing the following text in the composer — use it as a starting point and refine / expand it into a complete reply:\n"""\n${trimmedSource}\n"""`,
        );
      }
      if (trimmedInstruction) {
        parts.push(`Additional guidance from the user: "${trimmedInstruction}"`);
      }
      void submit(parts.join('\n\n'), trimmedInstruction || 'Refine draft');
    },
    [submit],
  );

  const refineDraft = useCallback(
    (instruction: string) => {
      const trimmedInstruction = instruction.trim();
      const parts = ['Draft a reply for this ticket.'];
      if (draftContent) {
        parts.push(
          `A previous AI draft was generated:\n"""\n${draftContent}\n"""\nRefine it per the user's guidance below.`,
        );
      }
      if (trimmedInstruction) {
        parts.push(`Refinement guidance from the user: "${trimmedInstruction}"`);
      }
      void submit(parts.join('\n\n'), trimmedInstruction || 'Refine draft');
    },
    [submit, draftContent],
  );

  const acceptDraft = useCallback(() => {
    setIsDraftActive(false);
    ourStreamIdRef.current = null;
    clearStorage();
    return draftContent;
  }, [draftContent, clearStorage]);

  const rejectDraft = useCallback(() => {
    if (threadId && ourStreamIdRef.current) {
      xyneAIStreamManager.abortStreamByThread(threadId);
    }
    ourStreamIdRef.current = null;
    setIsDraftActive(false);
    setDraftContent('');
    setIsStreaming(false);
    clearStorage();
  }, [threadId, clearStorage]);

  return {
    draftContent,
    isStreaming,
    isDraftActive,
    triggerDraft,
    rephraseDraft,
    refineDraft,
    acceptDraft,
    rejectDraft,
  };
}
