/**
 * Where this app is open — the LOCAL DEV implementation.
 *
 * An app can be opened from the toolbar, the Inbox menubar, a channel tab or the
 * Agent Hub, and the same build may want to look different in each. Published,
 * only the host knows which one it is, so it answers over postMessage.
 *
 * Locally there is no host, so this file stands in: it resolves a surface from
 * the URL, your last choice, or `devSurface` in xyne.json, and renders a small
 * switcher so you can flip between surfaces without republishing. The exported
 * API and the context shape are identical to the host's, so code that works here
 * works there.
 *
 * `push` never uploads this file and the host overwrites the path, so none of
 * the switcher below exists in the published app. Do not add app logic here.
 *
 * Switching surfaces, three ways:
 *   • the badge in the corner
 *   • ?xyne_surface=channel&xyne_channel=<id>   (bookmarkable, scriptable)
 *   • __xyne.setSurface('channel', '<id>')      (from the devtools console)
 */
import { useSyncExternalStore } from 'react';
import manifest from '../xyne.json';

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
  /** A coarse hint: a full page, or a panel beside other chrome. */
  layout: 'fullscreen' | 'panel';
}

/**
 * Where this app is running. `channel` exists only on the channel surface, so
 * `if (ctx.surface === 'channel')` narrows it.
 *
 * Not a permission: published, the host asserts this and the app cannot forge
 * it, but every call is still authorized as the viewer. Treat an unfamiliar
 * `surface` as the generic case — the host may learn new ones later.
 */
export type XyneAppContext =
  | (XyneAppContextBase & { surface: 'channel'; channel: XyneContextChannel })
  | (XyneAppContextBase & { surface: Exclude<XyneSurface, 'channel'>; channel?: never });

declare const __XYNE_APP_ID__: string;

const SURFACES: XyneSurface[] = ['toolbar', 'inbox', 'channel', 'library', 'standalone'];

/** Mirrors the host: the rail and the Agent Hub own the page, the others don't. */
const LAYOUT: Record<XyneSurface, 'fullscreen' | 'panel'> = {
  toolbar: 'fullscreen',
  library: 'fullscreen',
  chat: 'fullscreen',
  standalone: 'fullscreen',
  inbox: 'panel',
  channel: 'panel',
};

const STORAGE_KEY = 'xyne:dev-context';
const PANEL_WIDTH = '420px';

interface Selection {
  surface: XyneSurface;
  channelId: string;
  channelName: string;
  /** Preview frame only — never part of the context the app receives. */
  narrow: boolean;
  /** Delay the first answer, so the `null` branch is visible locally too. */
  delay: boolean;
}

const appId = typeof __XYNE_APP_ID__ !== 'undefined' ? __XYNE_APP_ID__ : '';

function readStored(): Partial<Selection> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Selection>) : {};
  } catch {
    return {};
  }
}

/** URL wins, then your last choice, then the app's own default in xyne.json. */
function initialSelection(): Selection {
  const params = new URLSearchParams(window.location.search);
  const stored = readStored();
  const fromUrl = params.get('xyne_surface') as XyneSurface | null;
  const declared = (manifest as { devSurface?: string }).devSurface as XyneSurface | undefined;
  const surface =
    (fromUrl && SURFACES.includes(fromUrl) && fromUrl) ||
    (stored.surface && SURFACES.includes(stored.surface) && stored.surface) ||
    (declared && SURFACES.includes(declared) && declared) ||
    'standalone';
  const channelId =
    params.get('xyne_channel') ??
    stored.channelId ??
    (manifest as { devChannelId?: string }).devChannelId ??
    '';
  return {
    surface,
    channelId,
    channelName: stored.channelId === channelId ? (stored.channelName ?? '') : '',
    narrow: stored.narrow ?? false,
    delay: stored.delay ?? false,
  };
}

let selection = initialSelection();
let context: XyneAppContext | null = null;
const listeners = new Set<() => void>();

function build(): XyneAppContext {
  const base = { v: 1, layout: LAYOUT[selection.surface], ...(appId ? { appId } : {}) };
  if (selection.surface === 'channel') {
    return {
      ...base,
      surface: 'channel',
      channel: {
        id: selection.channelId || 'dev-channel',
        name: selection.channelName || 'dev-channel',
        scopeType: 'DEFAULT',
      },
    };
  }
  return { ...base, surface: selection.surface };
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Private window or blocked storage: the choice simply won't survive a reload.
  }
  const url = new URL(window.location.href);
  url.searchParams.set('xyne_surface', selection.surface);
  if (selection.surface === 'channel' && selection.channelId) {
    url.searchParams.set('xyne_channel', selection.channelId);
  } else {
    url.searchParams.delete('xyne_channel');
  }
  window.history.replaceState(null, '', url.toString());
}

function apply(next: Partial<Selection>): void {
  selection = { ...selection, ...next };
  context = build();
  persist();
  applyFrame();
  render();
  listeners.forEach(listener => listener());
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): XyneAppContext | null => context;

/**
 * Where this app is open, or `null` until it is known.
 *
 * Published, the answer arrives a tick after first paint — render a skeleton for
 * the null case rather than guessing. Locally it resolves immediately unless you
 * tick "delay first answer" in the switcher.
 */
export function useXyneContext(): XyneAppContext | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Non-React read: resolves once the context is known. */
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

/** Subscribe to context changes (published: the viewer moved to another channel). */
export function onXyneContext(callback: (next: XyneAppContext) => void): () => void {
  return subscribe(() => {
    if (context) callback(context);
  });
}

// --- dev switcher -----------------------------------------------------------
// Everything below is local-only scaffolding.

/** Reframes the page to the width the chosen surface really gets. */
function applyFrame(): void {
  const style = document.body.style;
  if (selection.narrow) {
    style.maxWidth = PANEL_WIDTH;
    style.margin = '0 auto';
    style.borderLeft = '1px dashed rgba(127,127,127,.45)';
    style.borderRight = '1px dashed rgba(127,127,127,.45)';
  } else {
    style.maxWidth = '';
    style.margin = '';
    style.borderLeft = '';
    style.borderRight = '';
  }
}

let root: HTMLDivElement | null = null;
let open = false;
let channels: Array<{ id: string; name: string }> = [];
let channelsState: 'idle' | 'loading' | 'error' = 'idle';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.setAttribute('style', style);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Real channels, so you pick by name and the app gets a real id. */
async function loadChannels(): Promise<void> {
  if (channelsState === 'loading' || channels.length > 0) return;
  channelsState = 'loading';
  render();
  try {
    const { spaces } = await import('./xyne');
    const all = await spaces.channels.listAll();
    // Only real channels: those are the ones that can hold an app tab.
    channels = all
      .filter(c => !c.isArchived && c.scopeType === 'DEFAULT')
      .map(c => ({ id: c.id, name: c.name || c.id }))
      .filter(c => c.id)
      .sort((a, b) => a.name.localeCompare(b.name));
    channelsState = 'idle';
  } catch {
    // No token, or the proxy is down — the id field below still works.
    channelsState = 'error';
  }
  render();
}

const LABEL = 'font:500 11px/1.4 ui-sans-serif,system-ui,sans-serif;opacity:.65;';
const ROW = 'display:flex;align-items:center;gap:6px;font:400 12px/1.5 ui-sans-serif,system-ui,sans-serif;cursor:pointer;';

function render(): void {
  if (!root) return;
  root.textContent = '';

  const current =
    selection.surface === 'channel'
      ? `channel · ${selection.channelName || selection.channelId || 'unset'}`
      : selection.surface;

  const badge = el(
    'button',
    'all:unset;box-sizing:border-box;display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;' +
      'background:#111;color:#fff;font:500 12px/1 ui-sans-serif,system-ui,sans-serif;cursor:pointer;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.35);',
    `⚙ ${current}`,
  );
  badge.title = 'Xyne dev: change the surface this app thinks it is open in';
  badge.onclick = () => {
    open = !open;
    render();
  };

  if (!open) {
    root.appendChild(badge);
    return;
  }

  const panel = el(
    'div',
    'box-sizing:border-box;width:250px;margin-bottom:8px;padding:10px;border-radius:12px;background:#111;color:#fff;' +
      'box-shadow:0 8px 28px rgba(0,0,0,.4);display:flex;flex-direction:column;gap:8px;',
  );

  panel.appendChild(el('div', LABEL, 'SURFACE'));
  for (const surface of SURFACES) {
    const row = el('label', ROW);
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'xyne-dev-surface';
    input.checked = selection.surface === surface;
    input.onchange = () => {
      apply({ surface, narrow: LAYOUT[surface] === 'panel' });
      if (surface === 'channel') void loadChannels();
    };
    row.appendChild(input);
    row.appendChild(el('span', 'flex:1;', surface));
    row.appendChild(el('span', 'opacity:.45;font-size:11px;', LAYOUT[surface]));
    panel.appendChild(row);
  }

  if (selection.surface === 'channel') {
    panel.appendChild(el('div', LABEL, 'CHANNEL'));
    if (channelsState === 'loading') {
      panel.appendChild(el('div', 'font-size:11px;opacity:.6;', 'Loading channels…'));
    } else if (channels.length > 0) {
      const select = document.createElement('select');
      select.setAttribute(
        'style',
        'width:100%;padding:4px;border-radius:6px;background:#1c1c1c;color:#fff;border:1px solid #333;font-size:12px;',
      );
      for (const channel of channels) {
        const option = document.createElement('option');
        option.value = channel.id;
        option.textContent = `#${channel.name}`;
        option.selected = channel.id === selection.channelId;
        select.appendChild(option);
      }
      select.onchange = () => {
        const picked = channels.find(c => c.id === select.value);
        apply({ channelId: select.value, channelName: picked?.name ?? '' });
      };
      panel.appendChild(select);
    } else {
      if (channelsState === 'error') {
        panel.appendChild(
          el('div', 'font-size:11px;opacity:.6;', 'Could not list channels — paste an id:'),
        );
      }
      const input = document.createElement('input');
      input.value = selection.channelId;
      input.placeholder = 'channel id';
      input.setAttribute(
        'style',
        'width:100%;padding:4px;border-radius:6px;background:#1c1c1c;color:#fff;border:1px solid #333;font-size:12px;',
      );
      input.onchange = () => apply({ channelId: input.value.trim(), channelName: '' });
      panel.appendChild(input);
    }
  }

  panel.appendChild(el('div', LABEL, 'PREVIEW'));
  const narrowRow = el('label', ROW);
  const narrowInput = document.createElement('input');
  narrowInput.type = 'checkbox';
  narrowInput.checked = selection.narrow;
  narrowInput.onchange = () => apply({ narrow: narrowInput.checked });
  narrowRow.appendChild(narrowInput);
  narrowRow.appendChild(el('span', 'flex:1;', `panel width (${PANEL_WIDTH})`));
  panel.appendChild(narrowRow);

  const delayRow = el('label', ROW);
  const delayInput = document.createElement('input');
  delayInput.type = 'checkbox';
  delayInput.checked = selection.delay;
  delayInput.onchange = () => apply({ delay: delayInput.checked });
  delayRow.appendChild(delayInput);
  delayRow.appendChild(el('span', 'flex:1;', 'delay first answer'));
  delayRow.title = 'Published, context arrives after first paint. This makes that visible here.';
  panel.appendChild(delayRow);

  root.appendChild(panel);
  root.appendChild(badge);
}

function mount(): void {
  root = el(
    'div',
    'position:fixed;right:12px;bottom:12px;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-end;',
  );
  document.body.appendChild(root);
  applyFrame();
  render();
}

if (typeof window !== 'undefined' && window.parent === window) {
  (window as unknown as { __xyne: unknown }).__xyne = {
    setSurface: (surface: XyneSurface, channelId?: string) =>
      apply({ surface, ...(channelId ? { channelId, channelName: '' } : {}) }),
    get context() {
      return context;
    },
  };

  if (selection.delay) {
    setTimeout(() => apply({}), 600);
  } else {
    context = build();
  }
  persist();
  if (document.body) mount();
  else window.addEventListener('DOMContentLoaded', mount);
  if (selection.surface === 'channel') void loadChannels();
}
