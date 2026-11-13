import { useCallback, useRef, useState } from 'react';
import type { AiBuilderClient, AiBuilderMessage, AiBuilderToolCall } from '@xyne/workflow-sdk/ai-builder';
import type { StreamingState, StreamingTool } from '../components/shared/chat-types.js';

export interface UseApprovalAIReturn {
  messages: AiBuilderMessage[];
  pendingFormFill: Record<string, unknown> | null;
  isLoading: boolean;
  streaming: StreamingState | null;
  error: string | null;
  send: (text: string, currentFormValues?: Record<string, unknown>) => Promise<void>;
  stop: () => void;
  clearFormFill: () => void;
  reset: () => void;
}

export function useApprovalAI(
  client: AiBuilderClient,
  executionId: string,
): UseApprovalAIReturn {
  const [messages, setMessages] = useState<AiBuilderMessage[]>([]);
  const [pendingFormFill, setPendingFormFill] = useState<Record<string, unknown> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (text: string, currentFormValues?: Record<string, unknown>) => {
      const next: AiBuilderMessage[] = [...messages, { role: 'user', content: text }];
      setMessages(next);
      setIsLoading(true);
      setError(null);
      setStreaming({ text: '', tools: [] });

      const controller = new AbortController();
      abortRef.current = controller;

      let runningText = '';
      const tools: StreamingTool[] = [];
      let formFill: Record<string, unknown> | null = null;
      let aborted = false;

      try {
        await client.approvalChatStream(
          next,
          executionId,
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
            onFormFill: (ff) => { formFill = ff; },
            onDone: (message) => { runningText = message; },
            onError: (e) => { setError(e); },
          },
          currentFormValues,
          controller.signal,
        );
      } catch (err) {
        // AbortError (user pressed Stop) is expected — keep the partial text.
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
        if (formFill) setPendingFormFill(formFill);
        setStreaming(null);
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [client, executionId, messages],
  );

  const stop = useCallback(() => { abortRef.current?.abort(); }, []);

  const clearFormFill = useCallback(() => setPendingFormFill(null), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setPendingFormFill(null);
    setStreaming(null);
    setError(null);
    setIsLoading(false);
  }, []);

  return { messages, pendingFormFill, isLoading, streaming, error, send, stop, clearFormFill, reset };
}
