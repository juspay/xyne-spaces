import { useCallback, useRef } from 'react';
import type { FlowDefinition } from '@xyne/shared';
import { xyneAIStreamManager } from '../services/XyneAI';
import { fetchV2ConversationMessages } from '../services/XyneAI/XyneAISessionsV2Service';
import type { Message } from '../components/Chat/XyneAISidebar/utils/XyneAITypes';

export interface FlowActionCompleteOptions {
  conversationId: string | undefined;
  agentSlug: string | null | undefined;
  /** Manager thread key this surface's streams are registered under. */
  threadId: string;
  enabled: boolean;
  messages: Message[];
  setMessages: (next: Message[]) => void;
  detachLiveViewer: () => void;
  /** Ref shape differs per surface, so storing the detach fn is the caller's. */
  storeLiveViewer: (detach: () => void) => void;
}

/**
 * Shared by the /ai chat and the Xyne AI sidebar: re-read a message's FlowUI
 * cards after one completes an action. The server has already flipped the
 * stored card and dispatched any continuation, so re-reading beats synthesising
 * — a card left on its pending version stays submittable.
 */
export function useFlowActionComplete(options: FlowActionCompleteOptions): () => void {
  const {
    conversationId,
    agentSlug,
    threadId,
    enabled,
    messages,
    setMessages,
    detachLiveViewer,
    storeLiveViewer,
  } = options;

  // Ref, not a dep: this goes into a React.memo'd row, so a new function per
  // stream chunk would re-render every message for every token.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  return useCallback((): void => {
    if (!conversationId || !enabled) return;
    void (async (): Promise<void> => {
      const fresh = await fetchV2ConversationMessages(conversationId, agentSlug).catch(() => null);
      const base = xyneAIStreamManager.getActiveStream(threadId)?.messages ?? messagesRef.current;
      let merged = base;
      if (fresh) {
        const flowsById = new Map(fresh.map(m => [m.id, m.uiFlows]));
        const changed: Array<{ id: string; uiFlows: FlowDefinition[] }> = [];
        merged = base.map(msg => {
          const serverFlows = flowsById.get(msg.id);
          if (!serverFlows?.length) return msg;
          if (JSON.stringify(serverFlows) === JSON.stringify(msg.uiFlows)) return msg;
          changed.push({ id: msg.id, uiFlows: serverFlows });
          return { ...msg, uiFlows: serverFlows };
        });
        // Pick up turns this surface lacks — the continuation's reply once it lands.
        const known = new Set(base.map(m => m.id));
        const appended = fresh
          .filter(m => !known.has(m.id))
          .map(m => ({
            ...m,
            isStreaming: false,
            timestamp: m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp),
          }));
        if (appended.length > 0) merged = [...merged, ...appended];
        if (changed.length > 0 || appended.length > 0) {
          setMessages(merged);
          for (const entry of changed) {
            xyneAIStreamManager.patchMessageUiFlows(entry.id, entry.uiFlows);
          }
        }
      }
      // attachLiveViewer owns the dedupe; detaching first defeats it and seeds a
      // second placeholder, i.e. an extra "Thinking…" block per click.
      const live = xyneAIStreamManager.getActiveStream(threadId);
      if (live?.status === 'streaming') return;
      detachLiveViewer();
      storeLiveViewer(
        xyneAIStreamManager.attachLiveViewer(
          threadId,
          conversationId,
          agentSlug || 'ask-ai',
          merged,
        ),
      );
    })();
  }, [
    conversationId,
    agentSlug,
    threadId,
    enabled,
    setMessages,
    detachLiveViewer,
    storeLiveViewer,
  ]);
}
