import { useCallback, useRef, useState } from 'react';
import type { AiBuilderClient, AiBuilderMessage, AiBuilderToolCall, BuilderChatResponse } from '@xyne/workflow-sdk/ai-builder';
import type { WorkflowConfig } from '@xyne/workflow-sdk/builder';
import type { StreamingState, StreamingTool } from '../components/shared/chat-types.js';

export interface UseAiBuilderReturn {
  messages: AiBuilderMessage[];
  pendingPatch: BuilderChatResponse['workflowPatch'] | null;
  isLoading: boolean;
  /** Live assistant turn while streaming (text snapshot + tool chips), else null. */
  streaming: StreamingState | null;
  error: string | null;
  send: (text: string, currentConfig: WorkflowConfig) => Promise<void>;
  stop: () => void;
  clearPatch: () => void;
  reset: () => void;
}

export function useAiBuilder(client: AiBuilderClient): UseAiBuilderReturn {
  const [messages, setMessages] = useState<AiBuilderMessage[]>([]);
  const [pendingPatch, setPendingPatch] = useState<BuilderChatResponse['workflowPatch'] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (text: string, currentConfig: WorkflowConfig) => {
      const next: AiBuilderMessage[] = [...messages, { role: 'user', content: text }];
      setMessages(next);
      setIsLoading(true);
      setError(null);
      setStreaming({ text: '', tools: [] });

      const controller = new AbortController();
      abortRef.current = controller;

      let runningText = '';
      const tools: StreamingTool[] = [];
      let patch: WorkflowConfig | null = null;
      let aborted = false;

      try {
        await client.chatStream(
          next,
          currentConfig,
          {
            onText: (t) => { runningText = t; setStreaming({ text: t, tools: [...tools] }); },
            onTool: (tc) => {
              if (tc.status === 'start') {
                tools.push({ id: tc.id, name: tc.name, done: false });
              } else {
                const ex = tools.find((x) => x.id === tc.id);
                if (ex) { ex.done = true; ex.isError = tc.isError; }
                else tools.push({ id: tc.id, name: tc.name, done: true, isError: tc.isError });
              }
              setStreaming({ text: runningText, tools: [...tools] });
            },
            onPatch: (wp) => { patch = wp; },
            onDone: (message) => { runningText = message; },
            onError: (e) => { setError(e); },
          },
          controller.signal,
        );
      } catch (err) {
        if (controller.signal.aborted) {
          aborted = true;
        } else {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        const toolChips: AiBuilderToolCall[] = tools.map((t) => ({ name: t.name, ...(t.isError ? { isError: true } : {}) }));
        const content = runningText || (aborted ? '_(stopped)_' : '');
        if (content || toolChips.length > 0) {
          setMessages([
            ...next,
            { role: 'assistant', content, ...(toolChips.length ? { tools: toolChips } : {}) },
          ]);
        }
        if (patch) setPendingPatch(patch);
        setStreaming(null);
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [client, messages],
  );

  const stop = useCallback(() => { abortRef.current?.abort(); }, []);

  const clearPatch = useCallback(() => setPendingPatch(null), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setPendingPatch(null);
    setStreaming(null);
    setError(null);
  }, []);

  return { messages, pendingPatch, isLoading, streaming, error, send, stop, clearPatch, reset };
}
