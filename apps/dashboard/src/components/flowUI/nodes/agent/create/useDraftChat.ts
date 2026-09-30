import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentCreateFormState } from './types';
import {
  clearDraftChat,
  snapshotFromForm,
  streamDraftChat,
  type DraftChatExtras,
} from '@/services/claw/draftChat';
import { clawErrorText } from '@/services/claw/clawRequest';

export interface DraftChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** File names sent with a user message. */
  files?: string[];
  streaming?: boolean;
  error?: string;
}

/** One test conversation. Its id is the draft conversation id claw keeps context under. */
export interface DraftChatThread {
  id: string;
  messages: DraftChatMessage[];
}

function newId(): string {
  return crypto.randomUUID();
}

/** The thread's first message, which names it in the history menu. */
export function draftThreadTitle(thread: DraftChatThread | undefined): string {
  const first = thread?.messages.find(message => message.role === 'user')?.content.trim();
  return first || 'New chat';
}

export function useDraftChat(getForm: () => AgentCreateFormState): {
  threads: DraftChatThread[];
  activeThreadId: string;
  messages: DraftChatMessage[];
  pending: boolean;
  send: (text: string, extras: DraftChatExtras, options?: { fresh?: boolean }) => Promise<void>;
  stop: () => void;
  newChat: () => void;
  selectThread: (id: string) => void;
} {
  const [threads, setThreads] = useState<DraftChatThread[]>(() => [{ id: newId(), messages: [] }]);
  const [activeThreadId, setActiveThreadId] = useState(() => threads[0]!.id);
  const [pending, setPending] = useState(false);
  const activeRef = useRef(activeThreadId);
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const abortRef = useRef<AbortController | null>(null);
  const formRef = useRef(getForm);
  formRef.current = getForm;

  const stop = useCallback((): void => {
    abortRef.current?.abort();
  }, []);

  const activate = useCallback((id: string): void => {
    activeRef.current = id;
    setActiveThreadId(id);
  }, []);

  /** Moves to an empty thread, reusing the current one when nothing was said in it. */
  const startThread = useCallback((): string => {
    abortRef.current?.abort();
    const current = threadsRef.current.find(thread => thread.id === activeRef.current);
    if (current && current.messages.length === 0) return current.id;
    const id = newId();
    setThreads(prev => [...prev, { id, messages: [] }]);
    activate(id);
    return id;
  }, [activate]);

  const newChat = useCallback((): void => {
    startThread();
  }, [startThread]);

  const selectThread = useCallback(
    (id: string): void => {
      if (id === activeRef.current) return;
      abortRef.current?.abort();
      activate(id);
    },
    [activate],
  );

  const send = useCallback(
    async (
      text: string,
      extras: DraftChatExtras,
      options: { fresh?: boolean } = {},
    ): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed || abortRef.current) return;
      const threadId = options.fresh ? startThread() : activeRef.current;
      const update = (next: (messages: DraftChatMessage[]) => DraftChatMessage[]): void =>
        setThreads(prev =>
          prev.map(thread =>
            thread.id === threadId ? { ...thread, messages: next(thread.messages) } : thread,
          ),
        );
      const patch = (id: string, fields: Partial<DraftChatMessage>): void =>
        update(messages =>
          messages.map(message => (message.id === id ? { ...message, ...fields } : message)),
        );
      const assistantId = newId();
      update(messages => [
        ...messages,
        {
          id: newId(),
          role: 'user',
          content: trimmed,
          ...(extras.attachments.length > 0
            ? { files: extras.attachments.map(file => file.fileName) }
            : {}),
        },
        { id: assistantId, role: 'assistant', content: '', streaming: true },
      ]);
      const controller = new AbortController();
      abortRef.current = controller;
      setPending(true);
      try {
        await streamDraftChat({
          message: trimmed,
          draftConversationId: threadId,
          snapshot: snapshotFromForm(formRef.current()),
          extras,
          signal: controller.signal,
          handlers: {
            onDelta: delta => {
              update(messages =>
                messages.map(message =>
                  message.id === assistantId
                    ? { ...message, content: message.content + delta }
                    : message,
                ),
              );
            },
            onDone: finalText => {
              update(messages =>
                messages.map(message =>
                  message.id === assistantId
                    ? {
                        ...message,
                        streaming: false,
                        content:
                          finalText && message.content.length === 0 ? finalText : message.content,
                      }
                    : message,
                ),
              );
            },
            onError: message => patch(assistantId, { streaming: false, error: message }),
          },
        });
        patch(assistantId, { streaming: false });
      } catch (err) {
        if (controller.signal.aborted) {
          patch(assistantId, { streaming: false });
          return;
        }
        patch(assistantId, {
          streaming: false,
          error: clawErrorText(err, 'Could not reach the draft agent.'),
        });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setPending(false);
      }
    },
    [startThread],
  );

  // Test threads can't be reopened once the page is gone, so free them on claw.
  useEffect(
    () => (): void => {
      abortRef.current?.abort();
      for (const thread of threadsRef.current) {
        if (thread.messages.length > 0) void clearDraftChat(thread.id).catch(() => undefined);
      }
    },
    [],
  );

  const messages = threads.find(thread => thread.id === activeThreadId)?.messages ?? [];
  return { threads, activeThreadId, messages, pending, send, stop, newChat, selectThread };
}
