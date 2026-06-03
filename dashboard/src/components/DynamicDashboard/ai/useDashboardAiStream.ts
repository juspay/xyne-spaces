import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import type { DashboardAiEvent, DashboardPlan, DashboardToolCall } from '@xyne/shared';
import { streamDashboardAi } from '../../../services/DynamicDashboard/dashboardAiService';
import type { ChatTurn, SuggestComponentsArgs, ToolCallHandler, ToolCallResult } from './chatTypes';
import type { ToolInvocation } from '../../Chat/XyneAISidebar/utils/XyneAITypes';

interface UseDashboardAiStreamConfig {
  dataSourceId: string | null;
  currentPlan?: DashboardPlan;
  buildPrompt: (userText: string) => string;
  onToolCall: ToolCallHandler;
  lastError?: string | null;
}

interface UseDashboardAiStreamResult {
  turns: ChatTurn[];
  isStreaming: boolean;
  send: (prompt: string) => void;
  abort: () => void;
  suggestion: SuggestComponentsArgs | null;
  clearSuggestion: () => void;
}

function toolInvocationFromCall(
  call: DashboardToolCall,
  result: ToolCallResult | void,
): ToolInvocation {
  const base = {
    toolName: call.tool,
    args: call.args as Record<string, unknown>,
    durationMs: 0,
  };
  if (result && result.status === 'error') {
    return { ...base, status: 'error', result: result.message, isError: true };
  }
  return { ...base, status: 'completed' };
}

export function useDashboardAiStream(
  config: UseDashboardAiStreamConfig,
): UseDashboardAiStreamResult {
  const { dataSourceId, currentPlan, buildPrompt, onToolCall, lastError } = config;

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [suggestion, setSuggestion] = useState<SuggestComponentsArgs | null>(null);

  const streamRef = useRef<ReturnType<typeof streamDashboardAi> | null>(null);
  const streamSeqRef = useRef(0);
  const isStreamingRef = useRef(false);

  const onToolCallRef = useRef(onToolCall);
  const buildPromptRef = useRef(buildPrompt);
  useEffect(() => {
    onToolCallRef.current = onToolCall;
    buildPromptRef.current = buildPrompt;
  }, [onToolCall, buildPrompt]);

  useEffect(() => {
    return (): void => {
      streamRef.current?.abort();
    };
  }, []);

  const updateIsStreaming = useCallback((next: boolean): void => {
    isStreamingRef.current = next;
    setIsStreaming(next);
  }, []);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !dataSourceId || isStreamingRef.current) return;

      const userTurnId = uuidv4();
      const assistantTurnId = uuidv4();
      const mySeq = ++streamSeqRef.current;
      let buffer = '';

      setTurns(prev => [
        ...prev,
        { id: userTurnId, role: 'user', content: trimmed, toolInvocations: [] },
        { id: assistantTurnId, role: 'assistant', content: '', toolInvocations: [] },
      ]);
      setSuggestion(null);
      updateIsStreaming(true);
      streamRef.current?.abort();

      const abort = (): void => {
        streamRef.current?.abort();
        updateIsStreaming(false);
      };

      streamRef.current = streamDashboardAi({
        prompt: buildPromptRef.current(trimmed),
        dataSourceId,
        ...(currentPlan ? { currentPlan } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(lastError ? { lastError } : {}),
        onEvent: (event: DashboardAiEvent) => {
          if (mySeq !== streamSeqRef.current) return;
          if (event.type === 'start') {
            setSessionId(event.sessionId);
            return;
          }
          if (event.type === 'delta') {
            buffer += event.content;
            const content = buffer;
            setTurns(prev => prev.map(t => (t.id === assistantTurnId ? { ...t, content } : t)));
            return;
          }
          if (event.type === 'tool_call') {
            if (event.call.tool === 'suggest_components') {
              setSuggestion(event.call.args);
              abort();
              updateIsStreaming(false);
              return;
            }
            const maybeResult = onToolCallRef.current(event.call, { abort });
            const isAsync =
              !!maybeResult && typeof (maybeResult as Promise<unknown>).then === 'function';
            if (isAsync) {
              const toolCallId = uuidv4();
              const runningInvocation: ToolInvocation = {
                toolName: event.call.tool,
                args: event.call.args as Record<string, unknown>,
                durationMs: 0,
                status: 'running',
                toolCallId,
              };
              setTurns(prev =>
                prev.map(t =>
                  t.id === assistantTurnId
                    ? { ...t, toolInvocations: [...t.toolInvocations, runningInvocation] }
                    : t,
                ),
              );
              void (maybeResult as Promise<ToolCallResult>).then(result => {
                if (mySeq !== streamSeqRef.current) return;
                const finished = toolInvocationFromCall(event.call, result);
                setTurns(prev =>
                  prev.map(t =>
                    t.id === assistantTurnId
                      ? {
                          ...t,
                          toolInvocations: t.toolInvocations.map(inv =>
                            inv.toolCallId === toolCallId ? { ...finished, toolCallId } : inv,
                          ),
                        }
                      : t,
                  ),
                );
              });
            } else {
              const invocation = toolInvocationFromCall(
                event.call,
                maybeResult as ToolCallResult | void,
              );
              setTurns(prev =>
                prev.map(t =>
                  t.id === assistantTurnId
                    ? { ...t, toolInvocations: [...t.toolInvocations, invocation] }
                    : t,
                ),
              );
            }
            return;
          }
          if (event.type === 'complete') {
            if (event.summary) {
              buffer += event.summary;
              const content = buffer;
              setTurns(prev => prev.map(t => (t.id === assistantTurnId ? { ...t, content } : t)));
            }
            return;
          }
          if (event.type === 'error') {
            toast.error('AI error', { description: event.message });
            updateIsStreaming(false);
            return;
          }
          if (event.type === 'end') {
            updateIsStreaming(false);
          }
        },
        onError: err => {
          toast.error('AI stream failed', { description: err.message });
          updateIsStreaming(false);
        },
      });
    },
    [dataSourceId, currentPlan, sessionId, lastError, updateIsStreaming],
  );

  const abort = useCallback(() => {
    streamRef.current?.abort();
    streamSeqRef.current += 1;
    updateIsStreaming(false);
  }, [updateIsStreaming]);

  const clearSuggestion = useCallback(() => setSuggestion(null), []);

  return { turns, isStreaming, send, abort, suggestion, clearSuggestion };
}

export { toolInvocationFromCall };
