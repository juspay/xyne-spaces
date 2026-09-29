import { useCallback, useRef, useState } from 'react';
import type { AgentCreateFormState } from './types';
import {
  clearDraftChat,
  snapshotFromForm,
  streamDraftChat,
} from '@/services/claw/draftChat';
import { clawErrorText } from '@/services/claw/clawRequest';

export interface DraftChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  error?: string;
}

function newId(): string {
  return crypto.randomUUID();
}

export function useDraftChat(getForm: () => AgentCreateFormState): {
  messages: DraftChatMessage[];
  pending: boolean;
  send: (text: string) => Promise<void>;
  stop: () => void;
  clear: () => Promise<void>;
} {
  const [messages, setMessages] = useState<DraftChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const conversationIdRef = useRef(newId());
  const abortRef = useRef<AbortController | null>(null);
  const formRef = useRef(getForm);
  formRef.current = getForm;

  const stop = useCallback((): void => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed || abortRef.current) return;
    const assistantId = newId();
    setMessages(current => [
      ...current,
      { id: newId(), role: 'user', content: trimmed },
      { id: assistantId, role: 'assistant', content: '', streaming: true },
    ]);
    const controller = new AbortController();
    abortRef.current = controller;
    setPending(true);
    try {
      await streamDraftChat({
        message: trimmed,
        draftConversationId: conversationIdRef.current,
        snapshot: snapshotFromForm(formRef.current()),
        signal: controller.signal,
        handlers: {
          onDelta: delta => {
            setMessages(current =>
              current.map(message =>
                message.id === assistantId
                  ? { ...message, content: message.content + delta }
                  : message,
              ),
            );
          },
          onDone: finalText => {
            setMessages(current =>
              current.map(message =>
                message.id === assistantId
                  ? {
                      ...message,
                      streaming: false,
                      content: finalText && message.content.length === 0 ? finalText : message.content,
                    }
                  : message,
              ),
            );
          },
          onError: message => {
            setMessages(current =>
              current.map(item =>
                item.id === assistantId ? { ...item, streaming: false, error: message } : item,
              ),
            );
          },
        },
      });
      setMessages(current =>
        current.map(message =>
          message.id === assistantId ? { ...message, streaming: false } : message,
        ),
      );
    } catch (err) {
      if (controller.signal.aborted) {
        setMessages(current =>
          current.map(message =>
            message.id === assistantId ? { ...message, streaming: false } : message,
          ),
        );
        return;
      }
      const message = clawErrorText(err, 'Could not reach the draft agent.');
      setMessages(current =>
        current.map(item =>
          item.id === assistantId ? { ...item, streaming: false, error: message } : item,
        ),
      );
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setPending(false);
    }
  }, []);

  const clear = useCallback(async (): Promise<void> => {
    abortRef.current?.abort();
    const id = conversationIdRef.current;
    setMessages([]);
    conversationIdRef.current = newId();
    try {
      await clearDraftChat(id);
    } catch {
      // Local thread is already empty. The next turn uses a new conversation id.
    }
  }, []);

  return { messages, pending, send, stop, clear };
}
