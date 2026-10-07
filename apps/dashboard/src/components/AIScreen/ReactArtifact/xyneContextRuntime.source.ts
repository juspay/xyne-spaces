/**
 * Injected into every artifact project as `/lib/xyne-context.ts`.
 *
 * NOTE: this file is NOT part of the dashboard bundle. It is read with `?raw`
 * and compiled by Sandpack inside the preview iframe, so it may import nothing
 * but `react` (the template provides it). It is a real .ts file rather than a
 * string so it typechecks, and so app code gets true types for the hook.
 *
 * What it answers: "where am I open?" — the rail, the Inbox menubar, a channel
 * tab, the Agent Hub. Only the host knows; the backend has no idea where an
 * iframe is mounted. So the app asks over postMessage and the host replies, and
 * pushes again whenever the answer changes.
 *
 * The CLI scaffolds its own implementation of this exact path for `npm run dev`
 * (where there is no host, and a dev switcher stands in). `push` never uploads
 * it, and this copy overwrites whatever a payload ships — so an app imports one
 * module specifier and gets the right implementation in each environment. The
 * exported API and the context shape must therefore stay identical in both.
 */

import { useSyncExternalStore } from 'react';

const PROTOCOL_VERSION = 1;

export type XyneSurface = 'toolbar' | 'inbox' | 'channel' | 'library' | 'chat' | 'standalone';

export interface XyneContextChannel {
  id: string;
  name: string;
  scopeType: string;
}

interface XyneAppContextBase {
  v: number;
  appId?: string;
  workspaceId?: string;
  layout: 'fullscreen' | 'panel';
}

/**
 * Where this app is running. `channel` exists only on the channel surface, so
 * `if (ctx.surface === 'channel')` narrows it — no optional chaining needed.
 *
 * Not a permission: the host asserts it and the app cannot forge it, but every
 * call is still authorized as the viewer. Treat a new `surface` value you do
 * not recognise as the generic case rather than crashing — the host may learn
 * new places to open an app after this app was built.
 */
export type XyneAppContext =
  | (XyneAppContextBase & { surface: 'channel'; channel: XyneContextChannel })
  | (XyneAppContextBase & { surface: Exclude<XyneSurface, 'channel'>; channel?: never });

let context: XyneAppContext | null = null;
const listeners = new Set<() => void>();

const isContext = (value: unknown): value is XyneAppContext => {
  if (!value || typeof value !== 'object') return false;
  const c = value as Partial<XyneAppContext>;
  if (typeof c.surface !== 'string' || typeof c.layout !== 'string') return false;
  if (c.surface !== 'channel') return true;
  const channel = (c as { channel?: unknown }).channel as XyneContextChannel | undefined;
  return !!channel && typeof channel.id === 'string';
};

const embedded = typeof window !== 'undefined' && window.parent !== window;

const post = (type: string): void => {
  if (!embedded) return;
  window.parent.postMessage({ source: 'xyne-artifact', v: PROTOCOL_VERSION, type }, '*');
};

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { source?: string; type?: string; context?: unknown } | null;
    if (event.source !== window.parent) return;
    if (!data || data.source !== 'xyne-artifact-host' || data.type !== 'context') return;
    if (!isContext(data.context)) return;
    context = data.context;
    listeners.forEach(listener => listener());
  });
}

// The host attaches its listener with the iframe and this module runs after the
// bundle loads, so the first ask almost always lands. "Almost" is not good
// enough for a value the whole layout keys off, and a missed reply would
// otherwise only heal if the context happened to change later — so ask again a
// few times, and stop the moment an answer arrives.
if (embedded) {
  post('context-request');
  for (const delay of [200, 800, 2000]) {
    setTimeout(() => {
      if (!context) post('context-request');
    }, delay);
  }
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): XyneAppContext | null => context;

/**
 * Where this app is open, or `null` until the host says.
 *
 * Published, the answer arrives a tick after first paint, so render a skeleton
 * for the null case rather than guessing a surface and flashing the wrong
 * layout. In local dev it resolves immediately.
 */
export function useXyneContext(): XyneAppContext | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Non-React read: resolves once the host has answered. */
export function getXyneContext(timeoutMs = 5000): Promise<XyneAppContext> {
  if (context) return Promise.resolve(context);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error('Timed out waiting for the Xyne app context.'));
    }, timeoutMs);
    const stop = subscribe(() => {
      if (!context) return;
      clearTimeout(timer);
      stop();
      resolve(context);
    });
  });
}

/** Subscribe to context changes (e.g. the user moved to another channel). */
export function onXyneContext(callback: (next: XyneAppContext) => void): () => void {
  return subscribe(() => {
    if (context) callback(context);
  });
}
