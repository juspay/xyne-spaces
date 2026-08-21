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

import { useCallback, useState, useSyncExternalStore } from 'react';

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
