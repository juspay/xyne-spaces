/**
 * Talk to a conversational flow the way an integrating app would: through the
 * Conversation API (`client.conversations`), turn by turn. Test uses nothing
 * else, so what it shows is exactly what an app receives — and every request
 * and response is kept for the API view.
 *
 * The pattern is the one an app should use: follow the conversation's stream
 * for as long as it lasts, and send each answer without waiting — the next turn
 * arrives on the stream, with what is working (and what an agent writes) in
 * between. If the stream can't be opened, it falls back to asking again with
 * `waitMs`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { WorkflowClientError, type AdvanceConversation } from '@xyne/workflow-sdk/client';
import type { ConversationStreamEvent, Turn, TurnEvent, TurnScreen } from '@xyne/workflow-sdk/conversational-flow';
import { useWorkflowClient } from '../../../hooks/use-workflow-client.js';

export type ChatLine =
  | { from: 'bot'; text: string }
  | { from: 'person'; text: string }
  | { from: 'system'; text: string };

export type RunState = 'idle' | 'starting' | 'waiting' | 'thinking' | 'done' | 'failed';

/** One screen the conversation reached, and what led there. */
export interface TraceStep {
  turnId: string;
  screen?: TurnScreen | undefined;
  events: TurnEvent[];
}

/** One call to the Conversation API, as the API view shows it. A stream's response is the events it sent. */
export interface Exchange {
  id: number;
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  status?: number;
  response?: unknown;
  ms?: number;
  stream?: boolean;
}

/** While the flow works: what is running, and what an agent has written so far. */
export interface Live {
  status: string;
  text: string;
}

export function useConversation(workflowId: string | undefined) {
  const client = useWorkflowClient();
  const [turn, setTurn] = useState<Turn | null>(null);
  const [state, setState] = useState<RunState>('idle');
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const announced = useRef(new Set<string>());
  const [closing, setClosing] = useState<{ events: TurnEvent[]; outcome?: Record<string, unknown> | undefined } | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [error, setError] = useState<string | null>(null);

  const run = useRef(0);
  const live$ = useRef(true);
  const stream = useRef<AbortController | null>(null);
  const nextExchange = useRef(0);
  useEffect(
    () => () => {
      live$.current = false;
      stream.current?.abort();
    },
    [],
  );

  const record = useCallback((x: Omit<Exchange, 'id'>) => {
    const id = ++nextExchange.current;
    setExchanges((xs) => [...xs, { id, ...x }]);
    return (patch: Partial<Exchange> | ((x: Exchange) => Partial<Exchange>)) =>
      setExchanges((xs) => xs.map((e) => (e.id === id ? { ...e, ...(typeof patch === 'function' ? patch(e) : patch) } : e)));
  }, []);

  /** Make one API call, keeping its request and response for the API view. */
  const call = useCallback(
    async <T,>(method: Exchange['method'], path: string, body: unknown, send: () => Promise<T>): Promise<T> => {
      const started = performance.now();
      const update = record({ method, path, ...(body !== undefined ? { body } : {}) });
      const ms = () => Math.round(performance.now() - started);
      try {
        const result = await send();
        update({ status: method === 'POST' && path === '/conversations' ? 201 : 200, response: result, ms: ms() });
        return result;
      } catch (e) {
        if (e instanceof WorkflowClientError) update({ status: e.status, response: e.body, ms: ms() });
        throw e;
      }
    },
    [record],
  );

  /** Show a turn once: its messages in the chat, the screen in the trace, and whether it's our move. */
  const show = useCallback((next: Turn, token: number) => {
    if (!live$.current || token !== run.current) return;
    setTurn(next);
    if (next.turnId) {
      setLive(null);
      setLines((l) => [...l, ...next.messages.map((m) => ({ from: 'bot' as const, text: m.text }))]);
      setTrace((t) => [...t, { turnId: next.turnId!, screen: next.screen, events: next.events }]);
    }
    switch (next.status) {
      case 'awaiting_reply':
        setState('waiting');
        return;
      case 'working':
        setState('thinking');
        return;
      case 'finished':
        setLive(null);
        setClosing({ events: next.events, outcome: next.outcome });
        setLines((l) => [
          ...l,
          ...next.messages.map((m) => ({ from: 'bot' as const, text: m.text })),
          { from: 'system' as const, text: 'Conversation finished' },
        ]);
        setState('done');
        return;
      case 'handed_off':
        // A person has it now; Test answers for them, below.
        setLive(null);
        if (next.turnId && !announced.current.has(next.turnId)) {
          announced.current.add(next.turnId);
          setLines((l) => [...l, { from: 'system', text: 'Handed off to a person' }]);
        }
        setState('waiting');
        return;
      case 'ended':
        setLive(null);
        setLines((l) => [...l, { from: 'system', text: 'Conversation ended' }]);
        setState('done');
        return;
      case 'failed':
        setLive(null);
        setClosing({ events: next.events });
        setError(next.error?.message ?? 'The run failed.');
        setLines((l) => [...l, { from: 'system', text: 'The run failed' }]);
        setState('failed');
        return;
    }
  }, []);

  /** What a stream event means while waiting: the next turn, or what is happening meanwhile. */
  const apply = useCallback(
    (event: ConversationStreamEvent, token: number) => {
      if (token !== run.current) return;
      switch (event.type) {
        case 'turn':
          show(event.turn, token);
          return;
        case 'working':
          setLive((l) => ({
            status: event.kind === 'router' ? `${event.title ?? 'The router'} is deciding…` : event.kind === 'agent' ? `${event.title ?? 'Agent'} is answering…` : 'Working…',
            text: l?.text ?? '',
          }));
          return;
        case 'thinking':
          setLive((l) => ({ status: 'Thinking…', text: l?.text ?? '' }));
          return;
        case 'tool':
          if (event.phase === 'start') setLive((l) => ({ status: `Using ${event.tool}…`, text: l?.text ?? '' }));
          return;
        case 'text':
          setLive((l) => ({ status: l?.status ?? 'Answering…', text: (l?.text ?? '') + event.delta }));
          return;
      }
    },
    [show],
  );

  /**
   * Move the conversation on and play what happens, until it is their move.
   *
   * One call and one connection: the stream is the response to the action, so
   * there is no second place a turn can arrive from and nothing to reconcile.
   */
  const advance = useCallback(
    async (input: AdvanceConversation, token: number) => {
      stream.current?.abort();
      const controller = new AbortController();
      stream.current = controller;
      const started = performance.now();
      const update = record({ method: 'POST', path: '/conversations', body: input, stream: true, response: [] });
      try {
        for await (const event of client.conversations.advance({ ...input, stream: true, signal: controller.signal })) {
          update((x) => ({ status: 200, ms: x.ms ?? Math.round(performance.now() - started), response: [...((x.response as unknown[]) ?? []), event] }));
          apply(event, token);
        }
      } catch (e) {
        if (controller.signal.aborted || token !== run.current) return;
        if (e instanceof WorkflowClientError) update({ status: e.status, response: e.body, ms: Math.round(performance.now() - started) });
        // Answered a turn that had moved on: the refusal carries the current one.
        const current = e instanceof WorkflowClientError && e.status === 409 ? (e.body as { turn?: Turn }).turn : undefined;
        if (current) show(current, token);
        else fail(token, e);
      }
    },
    [client, record, apply, show],
  );

  const fail = (token: number, e: unknown) => {
    if (token !== run.current) return;
    setError(e instanceof Error ? e.message : String(e));
    setState('failed');
  };

  /** `context` is what the flow declared it is started with, as typed in the form. */
  const start = useCallback(
    async (context?: Record<string, unknown>) => {
      if (!workflowId) return;
      stream.current?.abort();
      const token = ++run.current;
      announced.current = new Set();
      setTurn(null);
      setLines([]);
      setTrace([]);
      setClosing(null);
      setLive(null);
      setExchanges([]);
      setError(null);
      setState('starting');
      await advance({ workflowId, ...(context && Object.keys(context).length > 0 ? { context } : {}) }, token);
    },
    [workflowId, advance],
  );

  const reply = useCallback(
    async (answer: { choice: string; label: string } | { text: string } | { values: Record<string, unknown>; label: string; choice?: string }) => {
      if (!turn?.turnId || (turn.status !== 'awaiting_reply' && turn.status !== 'handed_off')) return;
      const token = run.current;
      const byPerson = turn.status === 'handed_off' && 'choice' in answer;
      const closes = byPerson && turn.reply?.options.find((o) => o.id === answer.choice)?.kind === 'finish';
      setLines((l) => [
        ...l,
        byPerson
          ? { from: 'system', text: closes ? 'The person closed the conversation' : `The person handed it back: ${answer.label}` }
          : { from: 'person', text: 'text' in answer ? answer.text : answer.label },
      ]);
      setState('thinking');
      setLive({ status: 'Thinking…', text: '' });
      await advance(
        {
          conversationId: turn.conversationId,
          turnId: turn.turnId,
          ...('text' in answer
            ? { text: answer.text }
            : 'values' in answer
              ? { values: answer.values, ...(answer.choice !== undefined ? { choice: answer.choice } : {}) }
              : { choice: answer.choice }),
        },
        token,
      );
    },
    [turn, advance],
  );

  const end = useCallback(async () => {
    const id = turn?.conversationId;
    const token = ++run.current;
    stream.current?.abort();
    setLive(null);
    if (id && (state === 'waiting' || state === 'thinking')) {
      try {
        await call('POST', `/conversations/${id}/end`, undefined, () => client.conversations.end(id));
        setLines((l) => [...l, { from: 'system', text: 'Conversation ended' }]);
      } catch (e) {
        fail(token, e);
        return;
      }
    }
    setState('done');
  }, [client, turn, state, call]);

  const visited = trace.flatMap((t) => (t.screen ? [t.screen.id] : []));
  return { turn, state, lines, trace, closing, live, exchanges, error, visited, start, reply, end };
}

export type ConversationRun = ReturnType<typeof useConversation>;
