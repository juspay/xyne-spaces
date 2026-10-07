/**
 * Area 2: after any webview REMOUNT (panel<->fullscreen switch, docked panel
 * close -> reopen), browserPanelMachine keeps the tab's pre-remount
 * canGoBack/canGoForward. The back/forward buttons read the machine
 * (`disabled={!activeTab?.canGoBack}`) while the handlers check the LIVE
 * webview (`if (wv?.canGoBack()) wv.goBack()`), so until the fresh webview's
 * first `did-navigate` the buttons are enabled but silently dead — and stay
 * dead forever if the reload fails (did-fail-load is unbound).
 *
 * Red (pre-fix): dispatching `did-attach` (Electron's remount signal, emitted
 * before the fresh webview navigates) changes nothing — the back button stays
 * enabled though the live webview cannot go back.
 * Green (post-fix): did-attach re-syncs the machine from the live webview, so
 * the buttons go disabled immediately and re-enable only when navigation
 * history actually exists again.
 *
 * Rendering the full BrowserTabsScreen (real browserPanelActor, real
 * WebviewTab); the guest webview is jsdom's unknown element with its
 * Electron-only methods patched onto the instance, per the crash-recovery test.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { JSDOM } from '/workspace/xyne-spaces/node_modules/.pnpm/jsdom@28.1.0_@noble+hashes@2.2.0/node_modules/jsdom/lib/api.js';

vi.mock('../../../utils/electronApp', () => ({ isElectronApp: () => true }));
vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  Event: new Proxy({}, { get: (_t, k) => String(k) }),
}));
vi.mock('../../../machines/xyneAIMachine', () => ({
  xyneAIActor: { send: vi.fn(), getSnapshot: () => ({ context: {} }) },
}));
vi.mock('../../../hooks/useActivityTracking', () => ({
  useActivityTracking: () => ({ track: vi.fn(), trackActivity: vi.fn() }),
}));
vi.mock('../../../components/BrowserPanel/BrowserSettingsMenu', () => ({ BrowserSettingsMenu: () => null }));
vi.mock('../../../components/BrowserPanel/BrowserHintBar', () => ({ BrowserHintBar: () => null }));

let act: typeof import('react').act;
let createRoot: typeof import('react-dom/client').createRoot;
let MemoryRouter: typeof import('react-router-dom')['MemoryRouter'];
let BrowserTabsScreen: typeof import('../BrowserTabsScreen')['BrowserTabsScreen'];
let browserPanelActor: typeof import('../../../machines/browserPanelMachine')['browserPanelActor'];

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const g = globalThis as Record<string, unknown>;
for (const k of Object.getOwnPropertyNames(dom.window)) {
  if (k in g) continue;
  try { g[k] = (dom.window as unknown as Record<string, unknown>)[k]; } catch { /* skip */ }
}
g.window = dom.window;
g.document = dom.window.document;
g.IS_REACT_ACT_ENVIRONMENT = true;
g.__APP_VERSION__ = 'test';
for (const k of ['DOMMatrix', 'Path2D', 'ImageData']) if (!g[k]) g[k] = class {};
if (!g.ResizeObserver) g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

beforeAll(async () => {
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  ({ MemoryRouter } = await import('react-router-dom'));
  ({ BrowserTabsScreen } = await import('../BrowserTabsScreen'));
  ({ browserPanelActor } = await import('../../../machines/browserPanelMachine'));
});

const flush = async () => { await act(async () => { await Promise.resolve(); }); };

let lastRoot: { unmount: () => void } | null = null;
function unmount() {
  if (lastRoot) { act(() => { lastRoot!.unmount(); }); lastRoot = null; }
  (document.getElementById('root') as HTMLElement).innerHTML = '';
}

/** Simulate the machine state left by a deep navigation, then "remount" the screen. */
function mountWithStaleNavState(canGoBack: boolean, canGoForward = false) {
  browserPanelActor.send({
    type: 'ADD_TAB',
    tab: { id: 't1', url: 'https://example.com/deep', title: 'Ex', canGoBack, canGoForward, isLoading: false },
  } as never);
  const root = createRoot(document.getElementById('root') as HTMLElement);
  lastRoot = root;
  act(() => {
    root.render(
      <MemoryRouter>
        <BrowserTabsScreen variant="fullscreen" />
      </MemoryRouter>,
    );
  });
  const toggle = document.querySelector('button[title="Show browser controls"]') as HTMLButtonElement | null;
  if (!toggle) throw new Error('controls toggle not rendered');
  act(() => { toggle.click(); });
  return document.querySelector('webview') as HTMLElement;
}

function patchGuest(wv: HTMLElement, nav: { canGoBack: boolean; canGoForward: boolean; url: string }) {
  Object.assign(wv, {
    canGoBack: () => nav.canGoBack,
    canGoForward: () => nav.canGoForward,
    getURL: () => nav.url,
    goBack: () => { nav.goBackCalls = (nav.goBackCalls ?? 0) + 1; },
    goForward: () => { nav.goForwardCalls = (nav.goForwardCalls ?? 0) + 1; },
  });
  return nav as { canGoBack: boolean; canGoForward: boolean; url: string; goBackCalls?: number; goForwardCalls?: number };
}

const backButton = () => document.querySelector('button[title="Go back"]') as HTMLButtonElement | null;
const forwardButton = () => document.querySelector('button[title="Go forward"]') as HTMLButtonElement | null;

describe('BrowserTabsScreen back/forward sync across webview remount', () => {
  it('did-attach on a remounted webview disables the stale-enabled back button', async () => {
    unmount();
    // Pre-remount: user navigated deep, machine says canGoBack=true.
    const wv = mountWithStaleNavState(true);
    // Fresh webview: empty history, live canGoBack()=false.
    const nav = patchGuest(wv, { canGoBack: false, canGoForward: false, url: 'https://example.com/deep' });
    const enabledBefore = !backButton()!.disabled;
    act(() => { wv.dispatchEvent(new dom.window.Event('did-attach')); });
    await flush();
    // eslint-disable-next-line no-console
    console.log(`[back-forward] remount: enabledBefore=${enabledBefore} enabledAfterDidAttach=${!backButton()!.disabled} liveCanGoBack=${nav.canGoBack}`);
    expect(!backButton()!.disabled, 'back button must not stay enabled from the pre-remount machine state').toBe(false);
    expect(!forwardButton()!.disabled).toBe(false);
  });

  it('a completed navigation re-enables back and a click really goes back', async () => {
    unmount();
    const wv = mountWithStaleNavState(false);
    const nav = patchGuest(wv, { canGoBack: true, canGoForward: true, url: 'https://example.com/page2' });
    act(() => { wv.dispatchEvent(new dom.window.Event('did-navigate')); });
    await flush();
    expect(backButton()!.disabled).toBe(false);
    act(() => { backButton()!.click(); });
    await flush();
    // eslint-disable-next-line no-console
    console.log(`[back-forward] after did-navigate: goBackCalls=${nav.goBackCalls ?? 0} goForwardCalls=${nav.goForwardCalls ?? 0}`);
    expect(nav.goBackCalls, 'clicking an enabled back button must call webview.goBack()').toBe(1);
  });

  it('in-page (pushState) navigation still re-syncs the buttons', async () => {
    unmount();
    const wv = mountWithStaleNavState(false);
    patchGuest(wv, { canGoBack: true, canGoForward: false, url: 'https://spa.example/list' });
    act(() => { wv.dispatchEvent(new dom.window.Event('did-navigate-in-page')); });
    await flush();
    expect(backButton()!.disabled).toBe(false);
  });
});
