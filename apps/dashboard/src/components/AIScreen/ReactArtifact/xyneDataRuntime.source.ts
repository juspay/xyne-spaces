/**
 * Injected into every artifact project as `/lib/xyne-data.ts`.
 *
 * NOTE: this file is NOT part of the dashboard bundle. It is read with `?raw`
 * and compiled by Sandpack inside the preview iframe, so it may import nothing
 * but `react` (the template provides it). It is a real .ts file rather than a
 * string so it typechecks, and so agent-authored code gets true types for the
 * hook it is told to call.
 *
 * The app cannot reach the network: it runs on the bundler's origin with no
 * cookies. Instead the dashboard resolves the app's declared `dataRequirements`
 * as the current viewer and posts snapshots in over postMessage.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

const PROTOCOL_VERSION = 1;

interface Entry {
  status: 'loading' | 'ready' | 'error';
  data?: unknown;
  error?: string;
  meta?: { truncated: true; totalRows: number };
}

let snapshot: Record<string, Entry> = {};
/** Flips on first delivery, which is what separates "not sent yet" from "never declared". */
let hasSnapshot = false;

const listeners = new Set<() => void>();

/** Writes are request/response: each `mutate` waits for its own reply. */
type Pending = { resolve: () => void; reject: (e: Error) => void; timer: number };
const pending = new Map<string, Pending>();
let requestCounterFallback = 0;

function nextRequestId(): string {
  const c = (window as unknown as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  requestCounterFallback += 1;
  return `req-${Date.now()}-${requestCounterFallback}`;
}

/** A lost reply must reject rather than hang the app's await forever. */
const MUTATE_TIMEOUT_MS = 30000;
/** Cached so getSnapshot returns a referentially stable value — otherwise
 *  useSyncExternalStore re-renders forever. */
const fallbacks: Record<string, Entry> = {};
const refreshFns: Record<string, () => void> = {};

function post(message: Record<string, unknown>): void {
  if (window.parent === window) return;
  window.parent.postMessage({ source: 'xyne-artifact', v: PROTOCOL_VERSION, ...message }, '*');
}

window.addEventListener('message', (event: MessageEvent) => {
  // Only the host may deliver data. Artifact iframes share the bundler origin,
  // so without this check a sibling artifact could reach us through
  // `parent.frames[i]` and feed this app fabricated rows.
  if (event.source !== window.parent) return;

  const message = event.data as {
    source?: string;
    v?: number;
    type?: string;
    payloads?: Record<string, Entry>;
    requestId?: string;
    ok?: boolean;
    error?: string;
  } | null;

  if (!message || message.source !== 'xyne-artifact-host') return;
  // A newer major protocol may carry a shape this build cannot read.
  if (typeof message.v === 'number' && message.v > PROTOCOL_VERSION) return;

  if (message.type === 'mutate-result') {
    const entry = message.requestId ? pending.get(message.requestId) : undefined;
    if (!entry || !message.requestId) return;
    pending.delete(message.requestId);
    window.clearTimeout(entry.timer);
    if (message.ok) entry.resolve();
    else entry.reject(new Error(message.error || 'The change could not be saved.'));
    return;
  }

  if (message.type === 'agent-state' || message.type === 'agent-event') {
    applyAgentMessage(message as unknown as Record<string, unknown>);
    return;
  }

  if (message.type !== 'data') return;

  snapshot = message.payloads ?? {};
  hasSnapshot = true;
  listeners.forEach(listener => listener());
});

// Announce at module-eval time: the listener above is registered by now, and
// this re-runs on every iframe reload (including Sandpack's refresh button), so
// the host knows to re-deliver the snapshot it is already holding.
post({ type: 'ready' });

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function entryFor(name: string): Entry {
  const live = snapshot[name];
  if (live) return live;

  let fallback = fallbacks[name];
  if (!fallback) {
    fallback = hasSnapshot
      ? {
          status: 'error',
          error: `No data source named "${name}". Declare it in dataRequirements.`,
        }
      : { status: 'loading' };
    fallbacks[name] = fallback;
  }
  return fallback;
}

export interface XyneDataResult<T = unknown> {
  status: 'loading' | 'ready' | 'error';
  data: T | undefined;
  error: string | undefined;
  /** True when the result was capped — show the user that it is a partial view. */
  truncated: boolean;
  /** Ask the host to re-fetch just this requirement. */
  refresh: () => void;
}

/**
 * Read a declared data requirement.
 *
 * Handle every state: `loading` while it resolves, `error` when it fails, and
 * `ready` with an empty result — which is normal, because the data is fetched as
 * whoever is viewing and they may be permitted to see nothing.
 *
 * Dates arrive as epoch-millisecond numbers: `new Date(row.createdAt)`.
 */
export function useXyneData<T = unknown>(name: string): XyneDataResult<T> {
  const entry = useSyncExternalStore(
    subscribe,
    () => entryFor(name),
    () => entryFor(name),
  );

  let refresh = refreshFns[name];
  if (!refresh) {
    refresh = (): void => post({ type: 'refresh', name });
    refreshFns[name] = refresh;
  }

  return {
    status: entry.status,
    data: entry.data as T | undefined,
    error: entry.error,
    truncated: entry.meta?.truncated === true,
    refresh,
  };
}

/**
 * Make a change to workspace data.
 *
 * The write runs as whoever is using the app, under their own permissions — so
 * it can only do what that person could already do themselves, and it is
 * refused if they lack access. There is no undo: a change is immediate and
 * permanent.
 *
 * Only ever call this from a real user action (a click). Never write during
 * render or in an effect on mount.
 *
 *   const { mutate, status, error } = useXyneMutate();
 *   await mutate('ticket.update', { id, statusV2: 'COMPLETED' });
 */
export function useXyneMutate(): {
  mutate: (name: string, args?: unknown) => Promise<void>;
  status: 'idle' | 'pending' | 'error';
  error: string | undefined;
} {
  const [status, setStatus] = useState<'idle' | 'pending' | 'error'>('idle');
  const [error, setError] = useState<string | undefined>(undefined);

  const mutate = useCallback((name: string, args?: unknown): Promise<void> => {
    setStatus('pending');
    setError(undefined);

    return new Promise<void>((resolve, reject) => {
      const requestId = nextRequestId();
      const timer = window.setTimeout(() => {
        pending.delete(requestId);
        const timeout = new Error('The change timed out.');
        setStatus('error');
        setError(timeout.message);
        reject(timeout);
      }, MUTATE_TIMEOUT_MS);

      pending.set(requestId, {
        resolve: () => {
          setStatus('idle');
          resolve();
        },
        reject: (e: Error) => {
          setStatus('error');
          setError(e.message);
          reject(e);
        },
        timer,
      });

      post({ type: 'mutate', requestId, name, args });
    });
  }, []);

  return { mutate, status, error };
}

// ── Agents ────────────────────────────────────────────────────────────────────
//
// An app can hand work to a real claw agent. Three things make this different
// from reads and writes, and shape everything below:
//
//   1. A run takes MINUTES. There is no timeout here — the 30s ceiling on
//      mutations would fire on every single run.
//   2. A run OUTLIVES the app. It executes server-side, detached, so closing the
//      app or reloading the tab does not cancel it. The host re-sends the full
//      state whenever this module announces `ready`, which is why the hook needs
//      no storage of its own and why an app must simply render whatever state it
//      is handed on mount rather than starting a run to repopulate it.
//   3. Runs are threaded by `key`. One key is one conversation, so repeat calls
//      continue it and the agent keeps its context.

export type XyneAgentStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface XyneAgentInfo {
  slug: string;
  name: string;
  description: string;
  color: string;
}

interface AgentState {
  runId: string | null;
  status: XyneAgentStatus;
  output: string;
  reasoning: string;
  invocations: unknown[];
  label: string | null;
  error: string | null;
  agents: XyneAgentInfo[];
  /** False when agent runs are switched off for this workspace. */
  available: boolean;
}

const IDLE_AGENT_STATE: AgentState = {
  runId: null,
  status: 'idle',
  output: '',
  reasoning: '',
  invocations: [],
  label: null,
  error: null,
  agents: [],
  available: true,
};

/** One entry per run key. Values are replaced, never mutated, so the snapshot
 *  reference changes if and only if something changed. */
const agentStates = new Map<string, AgentState>();
const agentListeners = new Set<() => void>();
function agentStateFor(key: string): AgentState {
  return agentStates.get(key) ?? IDLE_AGENT_STATE;
}

function setAgentState(key: string, next: AgentState): void {
  agentStates.set(key, next);
  agentListeners.forEach(listener => listener());
}

function applyAgentMessage(message: Record<string, unknown>): void {
  const key = typeof message['runKey'] === 'string' ? message['runKey'] : '';
  if (!key) return;
  const current = agentStateFor(key);

  // Full state: the host's view wins outright. This is what restores a run the
  // user walked away from.
  if (message['type'] === 'agent-state') {
    const run = (message['run'] ?? {}) as Partial<AgentState>;
    setAgentState(key, {
      ...IDLE_AGENT_STATE,
      ...run,
      agents: Array.isArray(message['agents']) ? (message['agents'] as XyneAgentInfo[]) : [],
      available: message['available'] !== false,
    });
    return;
  }

  const kind = message['kind'];
  const text = typeof message['text'] === 'string' ? message['text'] : '';

  if (kind === 'accepted') {
    setAgentState(key, {
      ...current,
      runId: typeof message['runId'] === 'string' ? message['runId'] : null,
      status: 'running',
      // A new run replaces the previous answer, not appends to it.
      output: '',
      reasoning: '',
      invocations: [],
      label: null,
      error: null,
    });
    return;
  }

  if (kind === 'delta') {
    setAgentState(key, { ...current, status: 'running', output: current.output + text });
    return;
  }

  if (kind === 'reasoning') {
    setAgentState(key, { ...current, status: 'running', reasoning: current.reasoning + text });
    return;
  }

  if (kind === 'label') {
    setAgentState(key, {
      ...current,
      status: 'running',
      label: typeof message['label'] === 'string' ? message['label'] : null,
    });
    return;
  }

  if (kind === 'invocation') {
    setAgentState(key, {
      ...current,
      status: 'running',
      invocations: [...current.invocations, message['invocation']],
    });
    return;
  }

  if (kind === 'done') {
    const status = message['status'];
    setAgentState(key, {
      ...current,
      status: status === 'cancelled' ? 'cancelled' : status === 'failed' ? 'failed' : 'completed',
      // `done` carries the canonical answer; prefer it over accumulated deltas,
      // which can be missing a window if the stream reconnected mid-run.
      output: text || current.output,
      label: null,
      error: typeof message['error'] === 'string' ? message['error'] : current.error,
    });
    return;
  }

  if (kind === 'error') {
    setAgentState(key, {
      ...current,
      status: 'failed',
      label: null,
      error: typeof message['error'] === 'string' ? message['error'] : 'The agent run failed.',
    });
  }
}

function subscribeAgents(onChange: () => void): () => void {
  agentListeners.add(onChange);
  return () => {
    agentListeners.delete(onChange);
  };
}

export interface XyneAgentResult {
  /** Hand the agent a task. Resolves as soon as it is accepted — NOT when it
   *  finishes. Watch `status` and `output` for that. */
  run: (prompt: string, agentSlug?: string) => void;
  /** Stop the current run. No-op when nothing is running. */
  cancel: () => void;
  status: XyneAgentStatus;
  /** The answer, streaming in as it is written. */
  output: string;
  reasoning: string;
  /** Tool calls the agent has made — render these so a long run shows progress. */
  invocations: unknown[];
  /** What the agent is doing right now, e.g. "Searching tickets". */
  label: string | null;
  error: string | null;
  runId: string | null;
  /** Agents this viewer may use here. May be empty — say so rather than failing. */
  agents: XyneAgentInfo[];
  /** False when agent runs are turned off. Render a plain message, not an error. */
  available: boolean;
}

/**
 * Run a claw agent from inside the app.
 *
 * The agent runs AS THE PERSON USING THE APP, under their own permissions, so it
 * can only see and do what they could themselves.
 *
 * Runs take MINUTES. Render every status, and show `output`/`invocations` as
 * they arrive rather than a bare spinner. A run keeps going if the app is closed
 * and is restored when the user returns — so on mount, render whatever you are
 * given; never start a run just to repopulate it.
 *
 * Only call run() from a real user action such as a click.
 *
 *   const { run, status, output, invocations } = useXyneAgent({ key: 'triage' });
 *   <Button disabled={status === 'running'} onClick={() => run('Summarise these tickets')}>
 */
export function useXyneAgent(options?: { key?: string; agent?: string }): XyneAgentResult {
  const key = options?.key ?? 'default';
  const preferredAgent = options?.agent;

  const state = useSyncExternalStore(
    subscribeAgents,
    () => agentStateFor(key),
    () => agentStateFor(key),
  );

  // Ask the host for this key's state. Runs on mount, which is exactly when an
  // app is reopened onto a run that is already in flight somewhere.
  useEffect(() => {
    post({ type: 'agent-attach', runKey: key });
  }, [key]);

  const run = useCallback(
    (prompt: string, agentSlug?: string): void => {
      const text = typeof prompt === 'string' ? prompt.trim() : '';
      if (!text) return;
      // Optimistic, so a click feels immediate over a round trip that has to
      // resolve permissions and dispatch before it can answer.
      setAgentState(key, {
        ...agentStateFor(key),
        status: 'starting',
        output: '',
        reasoning: '',
        invocations: [],
        label: null,
        error: null,
      });
      const slug = agentSlug ?? preferredAgent;
      post({
        type: 'agent-run',
        runKey: key,
        prompt: text,
        ...(slug ? { agentSlug: slug } : {}),
      });
    },
    [key, preferredAgent],
  );

  const cancel = useCallback((): void => {
    post({ type: 'agent-cancel', runKey: key });
  }, [key]);

  return {
    run,
    cancel,
    status: state.status,
    output: state.output,
    reasoning: state.reasoning,
    invocations: state.invocations,
    label: state.label,
    error: state.error,
    runId: state.runId,
    agents: state.agents,
    available: state.available,
  };
}
