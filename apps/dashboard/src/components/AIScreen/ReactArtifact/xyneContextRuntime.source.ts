/**
 * Injected into every artifact project as `/lib/xyne-context.ts`.
 *
 * NOTE: this file is NOT part of the dashboard bundle. It is read with `?raw`
 * and compiled by Sandpack inside the preview iframe, so it may import nothing
 * but `react` (the template provides it). It is a real .ts file rather than a
 * string so it typechecks, and so app code gets true types for the hook.
 *
 * What it answers: "where am I open?" — the rail, the Inbox menubar, a channel
 * tab, the Agent Hub, a full-window overlay, a floating widget. Only the host
 * knows; the backend has no idea where an iframe is mounted. So the app asks
 * over postMessage and the host replies, and pushes again whenever the answer
 * changes.
 *
 * It also carries the few things an app may ask of the host: a widget's size,
 * opening a channel / app / AI chat in the main window, switching its own
 * overlay on or off, the pointer position for an overlay, and messages between
 * running copies of the same app.
 *
 * The CLI scaffolds its own implementation of this exact path for `npm run dev`
 * (where there is no host, and a dev switcher stands in). `push` never uploads
 * it, and this copy overwrites whatever a payload ships — so an app imports one
 * module specifier and gets the right implementation in each environment. The
 * exported API and the context shape must therefore stay identical in both.
 */

import { useSyncExternalStore } from 'react';

const PROTOCOL_VERSION = 1;

export type XyneSurface =
  | 'toolbar'
  | 'inbox'
  | 'channel'
  | 'library'
  | 'chat'
  | 'standalone'
  | 'overlay'
  | 'widget';

export interface XyneContextChannel {
  id: string;
  name: string;
  scopeType: string;
}

interface XyneAppContextBase {
  v: number;
  appId?: string;
  workspaceId?: string;
  layout: 'fullscreen' | 'panel' | 'overlay' | 'widget';
  /** False while the page is not on screen. Absent means true. */
  visible?: boolean;
  /** Whether the viewer's Spaces theme is light or dark. */
  colorScheme?: 'light' | 'dark';
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

/** Where `navigateTo` may send the main window. Ids only; the host builds the route. */
export type XyneNavigateTarget =
  | { kind: 'channel'; channelId: string }
  | { kind: 'app'; appId: string }
  | { kind: 'aiChat'; sessionId: string };

let context: XyneAppContext | null = null;
const listeners = new Set<() => void>();
const pointerListeners = new Set<(point: { x: number; y: number }) => void>();
const broadcastListeners = new Set<(payload: unknown) => void>();

const isContext = (value: unknown): value is XyneAppContext => {
  if (!value || typeof value !== 'object') return false;
  const c = value as Partial<XyneAppContext>;
  if (typeof c.surface !== 'string' || typeof c.layout !== 'string') return false;
  if (c.surface !== 'channel') return true;
  const channel = (c as { channel?: unknown }).channel as XyneContextChannel | undefined;
  return !!channel && typeof channel.id === 'string';
};

const embedded = typeof window !== 'undefined' && window.parent !== window;

const post = (type: string, extra: Record<string, unknown> = {}): void => {
  if (!embedded) return;
  window.parent.postMessage({ source: 'xyne-artifact', v: PROTOCOL_VERSION, type, ...extra }, '*');
};

/**
 * An overlay is drawn over Spaces, so its page must not paint a background.
 * The injected stylesheet gives `body` one; inline `!important` wins over it,
 * and a `normal` colour scheme keeps the browser from filling the frame when
 * the app's scheme differs from the page around it.
 */
const applySurfaceStyles = (next: XyneAppContext): void => {
  if (typeof document === 'undefined' || next.surface !== 'overlay') return;
  for (const el of [document.documentElement, document.body]) {
    if (!el) continue;
    el.style.setProperty('background', 'transparent', 'important');
    el.style.setProperty('color-scheme', 'normal');
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const data = event.data as {
      source?: string;
      type?: string;
      context?: unknown;
      x?: unknown;
      y?: unknown;
      payload?: unknown;
    } | null;
    if (!data || data.source !== 'xyne-artifact-host') return;
    if (data.type === 'context') {
      if (!isContext(data.context)) return;
      context = data.context;
      applySurfaceStyles(context);
      listeners.forEach(listener => listener());
      return;
    }
    if (data.type === 'pointer') {
      if (typeof data.x !== 'number' || typeof data.y !== 'number') return;
      const point = { x: data.x, y: data.y };
      pointerListeners.forEach(listener => listener(point));
      return;
    }
    if (data.type === 'broadcast') {
      broadcastListeners.forEach(listener => listener(data.payload));
    }
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

/**
 * Widget surface only: ask for a new size, in CSS pixels. The host clamps it to
 * its limits and to the window, so read your real size from CSS (or a
 * ResizeObserver) rather than assuming you got what you asked for.
 */
export function requestWidgetSize(width: number, height: number): void {
  post('surface-resize', { width, height });
}

/**
 * Open a channel, an app or an AI chat in the main window. Ignored for ids the
 * host does not accept; the viewer's own access still decides what they see.
 */
export function navigateTo(target: XyneNavigateTarget): void {
  post('navigate', { target });
}

/**
 * Turn this app's own overlay on or off — for example from a picker page. On
 * asks the viewer to confirm first; off is immediate. An app cannot switch on
 * any other app's overlay.
 */
export function setOverlayEnabled(enabled: boolean): void {
  post('overlay-set', { enabled });
}

/**
 * Overlay surface only: the pointer position in window coordinates, at most
 * once per frame. Clicks never reach an overlay, so this is the only way to
 * follow the pointer. Returns an unsubscribe function.
 */
export function onPointerMove(callback: (point: { x: number; y: number }) => void): () => void {
  pointerListeners.add(callback);
  if (pointerListeners.size === 1) post('pointer-subscribe', { enabled: true });
  return () => {
    pointerListeners.delete(callback);
    if (pointerListeners.size === 0) post('pointer-subscribe', { enabled: false });
  };
}

/**
 * Send a message to every other running copy of this app — for example from
 * its page to its overlay. Any structured-cloneable value; large payloads are
 * dropped.
 */
export function broadcast(payload: unknown): void {
  post('broadcast', { payload });
}

/** Receive messages sent with `broadcast` by other copies of this app. */
export function onBroadcast(callback: (payload: unknown) => void): () => void {
  broadcastListeners.add(callback);
  return () => {
    broadcastListeners.delete(callback);
  };
}
