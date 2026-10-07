/**
 * Area 3 recovery gap: BrowserTabsScreen's WebviewTab wires 8 webview events but
 * not `crashed` / `render-process-gone`, so a guest renderer crash leaves a
 * permanently dead tab: no message, no reload affordance, no recovery path.
 *
 * Red (pre-fix): dispatching `crashed` on the webview element changes nothing.
 * Green (post-fix): the tab shows a crashed overlay with a Reload affordance that
 * calls webview.reload(); a subsequent did-start-loading (any navigation start)
 * clears the state; a crashed background tab's overlay is not visible.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { JSDOM } from '/workspace/xyne-spaces/node_modules/.pnpm/jsdom@28.1.0_@noble+hashes@2.2.0/node_modules/jsdom/lib/api.js';

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  Event: new Proxy({}, { get: (_t, k) => String(k) }),
}));
vi.mock('../../machines/xyneAIMachine', () => ({
  xyneAIActor: { send: vi.fn(), getSnapshot: () => ({ context: {} }) },
}));
vi.mock('../../hooks/useActivityTracking', () => ({
  useActivityTracking: () => ({ trackActivity: vi.fn() }),
}));
vi.mock('../../components/BrowserPanel/BrowserSettingsMenu', () => ({ BrowserSettingsMenu: () => null }));
vi.mock('../../components/BrowserPanel/BrowserHintBar', () => ({ BrowserHintBar: () => null }));

// Module-level handles filled by beforeAll (dynamic imports run AFTER the JSDOM
// globals below are installed — static imports would hoist above them).
let act: typeof import('react').act;
let createRoot: typeof import('react-dom/client').createRoot;
let WebviewTab: typeof import('../BrowserTabsScreen')['WebviewTab'];

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const g = globalThis as Record<string, unknown>;
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'MutationObserver', 'localStorage', 'sessionStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'Element', 'Event', 'CustomEvent']) {
  try { if (!(k in g) || k === 'window' || k === 'document') g[k] = (dom.window as unknown as Record<string, unknown>)[k]; } catch { /* readonly */ }
}
for (const k of Object.getOwnPropertyNames(dom.window)) {
  if (k in g) continue;
  try { g[k] = (dom.window as unknown as Record<string, unknown>)[k]; } catch { /* skip */ }
}
g.IS_REACT_ACT_ENVIRONMENT = true;
g.__APP_VERSION__ = 'test';
for (const k of ['DOMMatrix', 'Path2D', 'ImageData']) if (!g[k]) g[k] = class {};
if (!g.ResizeObserver) g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

beforeAll(async () => {
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  ({ WebviewTab } = await import('../BrowserTabsScreen'));
});

const tab = { id: 't1', url: 'https://example.com/', title: 'Ex', canGoBack: false, canGoForward: false } as never;

let lastRoot: { unmount: () => void } | null = null;
function renderTab(isActive: boolean) {
  if (lastRoot) { act(() => { lastRoot!.unmount(); }); lastRoot = null; }
  (document.getElementById('root') as HTMLElement).innerHTML = '';
  const webviewRefs = { current: {} as Record<string, unknown> };
  const props = {
    tab,
    isActive,
    webviewRefs,
    onUpdate: vi.fn(),
    onUrlUpdate: vi.fn(),
    onFindResults: vi.fn(),
    isPanel: false,
  };
  const root = createRoot(document.getElementById('root') as HTMLElement);
  lastRoot = root;
  act(() => {
    root.render(<WebviewTab {...(props as never)} />);
  });
  return { webviewRefs, props, root };
}

const flush = async () => { await act(async () => { await Promise.resolve(); }); };

describe('WebviewTab crash recovery', () => {
  it('shows a crashed overlay with a working Reload affordance when the guest renderer crashes', async () => {
    const { webviewRefs } = renderTab(true);
    const wv = document.querySelector('webview') as HTMLElement | null;
    expect(wv).not.toBeNull();
    (webviewRefs.current['t1'] as { reload?: () => void }).reload = vi.fn();

    act(() => { wv!.dispatchEvent(new dom.window.Event('crashed')); });
    await flush();

    const overlay = document.querySelector('[data-testid="webview-crashed-t1"]') as HTMLElement | null;
    expect(overlay, 'crashed guest must surface a crashed overlay instead of a silent dead tab').not.toBeNull();

    const reloadBtn = document.querySelector('[data-testid="webview-reload-t1"]') as HTMLButtonElement | null;
    expect(reloadBtn).not.toBeNull();
    const reload = (webviewRefs.current['t1'] as { reload: ReturnType<typeof vi.fn> }).reload;
    act(() => { reloadBtn!.click(); });
    await flush();
    expect(reload, 'Reload button must call webview.reload()').toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid="webview-crashed-t1"]')).toBeNull();
  });

  it('treats render-process-gone as a crash too', async () => {
    const { webviewRefs } = renderTab(true);
    const wv = document.querySelector('webview') as HTMLElement;
    (webviewRefs.current['t1'] as Record<string, unknown>).reload = vi.fn();
    act(() => { wv.dispatchEvent(new dom.window.Event('render-process-gone')); });
    await flush();
    expect(document.querySelector('[data-testid="webview-crashed-t1"]')).not.toBeNull();
  });

  it('a navigation start clears the crashed state (recovery is reachable)', async () => {
    renderTab(true);
    const wv = document.querySelector('webview') as HTMLElement;
    act(() => { wv.dispatchEvent(new dom.window.Event('crashed')); });
    await flush();
    expect(document.querySelector('[data-testid="webview-crashed-t1"]')).not.toBeNull();
    act(() => { wv.dispatchEvent(new dom.window.Event('did-start-loading')); });
    await flush();
    expect(document.querySelector('[data-testid="webview-crashed-t1"]')).toBeNull();
  });

  it("a crashed background tab's overlay is not visible over other tabs", async () => {
    renderTab(false);
    const wv = document.querySelector('webview') as HTMLElement;
    act(() => { wv.dispatchEvent(new dom.window.Event('crashed')); });
    await flush();
    const overlay = document.querySelector('[data-testid="webview-crashed-t1"]') as HTMLElement | null;
    expect(overlay).not.toBeNull();
    expect(overlay!.style.visibility).toBe('hidden');
  });
});
