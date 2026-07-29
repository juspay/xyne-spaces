import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import type { DashboardPlan, QueryVisualizationType } from '@xyne/shared';
import {
  streamDashboardAi,
  cancelDashboardAi,
  type ClawStreamEvent,
} from '../services/DynamicDashboard/dashboardAiService';
import type {
  ChatTurn,
  DrillPayload,
  SuggestComponentsArgs,
} from '../components/DynamicDashboard/ai/chatTypes';
import type { ToolInvocation } from '../components/Chat/XyneAISidebar/utils/XyneAITypes';

interface UseDashboardAiStreamConfig {
  dataSourceId: string | null;
  dashboardId?: string;
  currentPlan?: DashboardPlan;
  buildPrompt: (userText: string) => string;
  lastError?: string | null;
  focusedComponentId?: string;
  onDashboardMutated?: () => void;
  onDrillResult?: (drill: DrillPayload, ctx: { abort: () => void }) => boolean | void;
}

interface UseDashboardAiStreamResult {
  turns: ChatTurn[];
  isStreaming: boolean;
  send: (prompt: string) => void;
  abort: () => void;
  suggestion: SuggestComponentsArgs | null;
  reset: () => void;
}

const PERSISTING_TOOLS = new Set([
  'set_dashboard_meta',
  'add_component',
  'update_component',
  'remove_component',
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

type InvocationStatus = 'running' | 'completed' | 'error';

interface ParsedInvocation {
  toolCallId: string;
  toolName: string;
  baseTool: string;
  args: Record<string, unknown> | undefined;
  result: string | undefined;
  status: InvocationStatus;
  durationMs: number | undefined;
}

function parseInvocation(raw: unknown): ParsedInvocation {
  const inv = isRecord(raw) ? raw : {};
  const toolName = typeof inv['toolName'] === 'string' ? inv['toolName'] : 'tool';
  const status: InvocationStatus =
    inv['status'] === 'completed' || inv['status'] === 'error'
      ? inv['status']
      : inv['isError']
        ? 'error'
        : 'running';
  return {
    toolCallId: typeof inv['toolCallId'] === 'string' ? inv['toolCallId'] : `tc-${toolName}`,
    toolName,
    baseTool: toolName.includes('__') ? (toolName.split('__').pop() ?? toolName) : toolName,
    args: isRecord(inv['args']) ? inv['args'] : undefined,
    result:
      typeof inv['result'] === 'string'
        ? inv['result']
        : inv['result'] !== undefined
          ? JSON.stringify(inv['result'])
          : undefined,
    status,
    durationMs: typeof inv['durationMs'] === 'number' ? inv['durationMs'] : undefined,
  };
}

function mergeInvocation(turn: ChatTurn, inv: ParsedInvocation): ChatTurn {
  const merged: ToolInvocation = {
    toolName: inv.toolName,
    toolCallId: inv.toolCallId,
    args: inv.args ?? {},
    durationMs: inv.durationMs ?? 0,
    status: inv.status,
    ...(inv.result !== undefined ? { result: inv.result } : {}),
    ...(inv.status === 'error' ? { isError: true } : {}),
  };
  const idx = turn.toolInvocations.findIndex(i => i.toolCallId === inv.toolCallId);
  return {
    ...turn,
    toolInvocations:
      idx === -1
        ? [...turn.toolInvocations, merged]
        : turn.toolInvocations.map((i, k) => (k === idx ? merged : i)),
  };
}

export function useDashboardAiStream(
  config: UseDashboardAiStreamConfig,
): UseDashboardAiStreamResult {
  const {
    dataSourceId,
    dashboardId,
    currentPlan,
    buildPrompt,
    lastError,
    focusedComponentId,
    onDashboardMutated,
    onDrillResult,
  } = config;

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [suggestion, setSuggestion] = useState<SuggestComponentsArgs | null>(null);

  const streamRef = useRef<ReturnType<typeof streamDashboardAi> | null>(null);
  const streamSeqRef = useRef(0);
  const isStreamingRef = useRef(false);
  const pendingNewThreadRef = useRef(false);
  const runIdRef = useRef<string | null>(null);
  // Tool-call ids whose one-shot side effect (suggestion, drill turn, refetch)
  // already ran, so a re-emitted invocation can't duplicate it.
  const processedToolCallsRef = useRef<Set<string>>(new Set());

  const buildPromptRef = useRef(buildPrompt);
  const onDashboardMutatedRef = useRef(onDashboardMutated);
  const onDrillResultRef = useRef(onDrillResult);
  useEffect(() => {
    buildPromptRef.current = buildPrompt;
    onDashboardMutatedRef.current = onDashboardMutated;
    onDrillResultRef.current = onDrillResult;
  }, [buildPrompt, onDashboardMutated, onDrillResult]);

  useEffect(() => {
    return (): void => {
      streamRef.current?.abort();
    };
  }, []);

  const updateIsStreaming = useCallback((next: boolean): void => {
    isStreamingRef.current = next;
    setIsStreaming(next);
  }, []);

  const cancelActiveRun = useCallback((): void => {
    const runId = runIdRef.current;
    if (!runId) return;
    runIdRef.current = null;
    void cancelDashboardAi(runId).catch(() => {
      // Best-effort; the local abort + backend res.on('close') still tear down.
    });
  }, []);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreamingRef.current) return;
      if (!dataSourceId) {
        toast.error('No data source', {
          description: 'This dashboard has no connected data source to query yet.',
        });
        return;
      }

      const newThread = pendingNewThreadRef.current;
      pendingNewThreadRef.current = false;

      const userTurnId = uuidv4();
      const assistantTurnId = uuidv4();
      const mySeq = ++streamSeqRef.current;
      processedToolCallsRef.current = new Set();
      runIdRef.current = null;
      let buffer = '';

      setTurns(prev => [
        ...prev,
        { id: userTurnId, role: 'user', content: trimmed, toolInvocations: [] },
        { id: assistantTurnId, role: 'assistant', content: '', toolInvocations: [] },
      ]);
      setSuggestion(null);
      updateIsStreaming(true);
      streamRef.current?.abort();

      const updateAssistant = (fn: (turn: ChatTurn) => ChatTurn): void =>
        setTurns(prev => prev.map(t => (t.id === assistantTurnId ? fn(t) : t)));

      const abort = (): void => {
        cancelActiveRun();
        streamRef.current?.abort();
        streamSeqRef.current += 1;
        updateIsStreaming(false);
      };

      const runToolSideEffect = (inv: ParsedInvocation): void => {
        if (processedToolCallsRef.current.has(inv.toolCallId)) return;
        const payload = inv.args ?? {};

        if (inv.baseTool === 'suggest_components') {
          const { message, suggestions } = payload;
          if (typeof message === 'string' && Array.isArray(suggestions) && suggestions.length) {
            processedToolCallsRef.current.add(inv.toolCallId);
            setSuggestion({
              message,
              suggestions: suggestions as Array<{ label: string; prompt: string }>,
            });
          }
        } else if (inv.baseTool === 'drill_result') {
          const { title, visualType, queryPlan } = payload;
          if (
            typeof title === 'string' &&
            typeof visualType === 'string' &&
            queryPlan !== undefined
          ) {
            processedToolCallsRef.current.add(inv.toolCallId);
            const drill: DrillPayload = {
              title,
              visualType: visualType as QueryVisualizationType,
              queryPlan,
            };
            if (onDrillResultRef.current?.(drill, { abort }) !== true) {
              setTurns(prev => [
                ...prev,
                {
                  id: `drill-${streamSeqRef.current}-${prev.length}`,
                  role: 'assistant',
                  content: '',
                  toolInvocations: [],
                  drill,
                },
              ]);
            }
          }
        } else if (inv.status === 'completed' && PERSISTING_TOOLS.has(inv.baseTool)) {
          processedToolCallsRef.current.add(inv.toolCallId);
          onDashboardMutatedRef.current?.();
        }
      };

      const handle = streamDashboardAi({
        prompt: buildPromptRef.current(trimmed),
        dataSourceId,
        ...(dashboardId ? { dashboardId } : {}),
        ...(currentPlan ? { currentPlan } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(lastError ? { lastError } : {}),
        ...(focusedComponentId ? { focusedComponentId } : {}),
        ...(newThread ? { newThread: true } : {}),
        onEvent: (event: ClawStreamEvent) => {
          if (mySeq !== streamSeqRef.current) return;
          switch (event.type) {
            case 'start':
              if (typeof event['sessionId'] === 'string') setSessionId(event['sessionId']);
              if (typeof event['traceId'] === 'string') runIdRef.current = event['traceId'];
              return;
            case 'delta':
              if (typeof event['content'] === 'string') buffer += event['content'];
              updateAssistant(t => ({ ...t, content: buffer }));
              return;
            case 'reasoning_delta': {
              const delta =
                typeof event['reasoningDelta'] === 'string' ? event['reasoningDelta'] : '';
              updateAssistant(t => ({ ...t, reasoning: (t.reasoning ?? '') + delta }));
              return;
            }
            case 'tool_invocation': {
              const inv = parseInvocation(event['toolInvocation']);
              runToolSideEffect(inv);
              updateAssistant(t => mergeInvocation(t, inv));
              return;
            }
            case 'complete': {
              const summary = typeof event['content'] === 'string' ? event['content'] : '';
              if (summary && !buffer) {
                buffer = summary;
                updateAssistant(t => ({ ...t, content: buffer }));
              }
              updateIsStreaming(false);
              return;
            }
            case 'error': {
              const message =
                typeof event['error'] === 'string'
                  ? event['error']
                  : typeof event['message'] === 'string'
                    ? event['message']
                    : 'AI error';
              updateAssistant(t =>
                !t.content && t.toolInvocations.length === 0 && !t.reasoning
                  ? { ...t, content: `⚠️ ${message}` }
                  : t,
              );
              toast.error('AI error', { description: message });
              updateIsStreaming(false);
              return;
            }
          }
        },
        onError: err => {
          toast.error('AI stream failed', { description: err.message });
          updateIsStreaming(false);
        },
      });
      streamRef.current = handle;
      void handle.done.finally(() => {
        if (mySeq === streamSeqRef.current) updateIsStreaming(false);
      });
    },
    [
      dataSourceId,
      dashboardId,
      currentPlan,
      sessionId,
      lastError,
      focusedComponentId,
      updateIsStreaming,
      cancelActiveRun,
    ],
  );

  const abort = useCallback(() => {
    cancelActiveRun();
    streamRef.current?.abort();
    streamSeqRef.current += 1;
    updateIsStreaming(false);
  }, [updateIsStreaming, cancelActiveRun]);

  const reset = useCallback(() => {
    cancelActiveRun();
    streamRef.current?.abort();
    streamSeqRef.current += 1;
    updateIsStreaming(false);
    setTurns([]);
    setSessionId(undefined);
    setSuggestion(null);
    processedToolCallsRef.current = new Set();
    pendingNewThreadRef.current = true;
  }, [updateIsStreaming, cancelActiveRun]);

  return { turns, isStreaming, send, abort, suggestion, reset };
}
