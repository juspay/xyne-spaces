/**
 * Area 2 proof: WorkspacePane is mounted once and NOT keyed by conversationId
 * (routes/AIScreen/AIScreen.tsx:629). On an in-place thread switch A -> B the
 * per-thread "last open artifact" memory (localStorage xyne-workspace-last-open:<id>)
 * is corrupted/erased and B does not reopen where the user left it.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { JSDOM } from '/workspace/xyne-spaces/node_modules/.pnpm/jsdom@28.1.0_@noble+hashes@2.2.0/node_modules/jsdom/lib/api.js';

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

type Row = Record<string, unknown>;
const OLD = '2020-01-01T00:00:00.000Z'; // older than the 2-min "new artifact" window
const app = (id: string, conv: string, refId: string): Row => ({
  id, conversationId: conv, kind: 'REACT_APP', refService: 'CLAW', refId, title: id,
  status: 'ACTIVE', pinned: false, createdAt: OLD, updatedAt: OLD,
  openRef: { kind: 'REACT_APP', service: 'CLAW', refId },
});
const DATA: Record<string, Row[]> = {
  A: [app('a1', 'A', 'appA')],
  B: [app('b1', 'B', 'appB')],
};
// simulate react-query cache: B is loaded (cached) unless listed here
const loading = new Set<string>();

vi.mock('../useConversationArtifacts', () => ({
  useConversationArtifacts: (id: string | null) => ({
    artifacts: id && !loading.has(id) ? DATA[id] ?? [] : [],
    isLoading: !!id && loading.has(id),
    isError: false,
    patch: () => {},
  }),
}));




const Stub = () => null;
vi.mock('../ArtifactList', () => ({ ArtifactList: Stub }));
vi.mock('../ArtifactInlineView', () => ({ ArtifactInlineView: Stub, artifactInlineActions: () => null }));
vi.mock('../AiBrowserItemView', () => ({ AiBrowserItemView: Stub }));
vi.mock('../AiDocItemView', () => ({ AiDocItemView: Stub }));
vi.mock('../../CitationDocsPanel', () => ({ default: Stub }));
vi.mock('../../../ui/Tabs', () => ({}));
vi.mock('../../../../services/clients/fileFetchService', () => ({ downloadFile: () => {}, fetchFile: async () => '' }));
vi.mock('../../../workspaceItems', async () => ({
  ...(await import('../../../workspaceItems/tabState')),
  ...(await import('../../../workspaceItems/itemDescriptor')),
  ...(await import('../../../workspaceItems/openItems')),
  registerCommentStore: () => {},
  WorkspaceSurface: Stub,
  QuickSwitch: Stub,
}));

let React: typeof import('react');
let act: typeof import('react').act;
let createRoot: typeof import('react-dom/client').createRoot;
let WorkspacePane: typeof import('../WorkspacePane').WorkspacePane;

beforeAll(async () => {
  React = await import('react');
  act = React.act;
  ({ createRoot } = await import('react-dom/client'));
  ({ WorkspacePane } = await import('../WorkspacePane'));
}, 120_000);

const KEY = (c: string) => `xyne-workspace-last-open:${c}`;

async function scenario(bCachedAtSwitch: boolean, keyed = false) {
  localStorage.clear();
  loading.clear();
  // the user previously left thread B with artifact b1 open
  localStorage.setItem(KEY('B'), 'b1');
  const shown: (string | null)[] = [];
  const writes: string[] = [];
  const P = (dom.window as unknown as { Storage: { prototype: Storage } }).Storage.prototype;
  const realSet = P.setItem;
  const realRemove = P.removeItem;
  P.setItem = function (this: Storage, k: string, v: string) { if (k.startsWith('xyne-workspace-last-open')) writes.push(`set ${k}=${v}`); return realSet.call(this, k, v); };
  P.removeItem = function (this: Storage, k: string) { if (k.startsWith('xyne-workspace-last-open')) writes.push(`remove ${k}`); return realRemove.call(this, k); };

  const root = createRoot(document.getElementById('root')!);
  const onShown = (id: string | null) => shown.push(id);
  const render = (conv: string, seq: number, openArtifactId: string | null) =>
    React.createElement(WorkspacePane, {
      ...(keyed ? { key: conv } : {}),
      conversationId: conv,
      appPane: null,
      openRequest: { seq, tab: 'artifacts', openArtifactId },
      onShownAppChange: onShown,
    });

  // user is in thread A and opens artifact a1
  await act(async () => { root.render(render('A', 1, 'a1')); });
  const shownInA = shown[shown.length - 1];
  writes.length = 0;
  if (!bCachedAtSwitch) loading.add('B');
  // user clicks thread B in the sidebar (same mounted pane, new conversationId)
  await act(async () => { root.render(render('B', 1, 'a1')); });
  if (!bCachedAtSwitch) {
    loading.delete('B');
    await act(async () => { root.render(render('B', 1, 'a1')); }); // B's artifacts arrive
  }
  const result = { shownInA, shownInB: shown[shown.length - 1], keyB: localStorage.getItem(KEY('B')), writes: [...writes] };
  await act(async () => { root.unmount(); });
  P.setItem = realSet; P.removeItem = realRemove;
  return result;
}

describe('WorkspacePane last-open memory across an in-place thread switch', () => {
  beforeEach(() => localStorage.clear());

  it('control: fresh mount on B restores b1 (feature works without a switch)', async () => {
    localStorage.setItem(KEY('B'), 'b1');
    const shown: (string | null)[] = [];
    const root = createRoot(document.getElementById('root')!);
    await act(async () => {
      root.render(React.createElement(WorkspacePane, {
        conversationId: 'B', appPane: null, openRequest: { seq: 0, tab: 'artifacts' },
        onShownAppChange: (id: string | null) => shown.push(id),
      }));
    });
    const shownB = shown[shown.length - 1];
    console.log('CONTROL fresh-mount B shown=', shownB, 'keyB=', localStorage.getItem(KEY('B')));
    expect(shownB).toBe('appB');
    await act(async () => { root.unmount(); });
  });

  it('cold mount on B while artifacts load (page reload / first visit) keeps and restores b1', async () => {
    localStorage.setItem(KEY('B'), 'b1');
    loading.clear(); loading.add('B');
    const shown: (string | null)[] = [];
    const root = createRoot(document.getElementById('root')!);
    const el = () => React.createElement(WorkspacePane, {
      conversationId: 'B', appPane: null, openRequest: { seq: 0, tab: 'artifacts' },
      onShownAppChange: (id: string | null) => shown.push(id),
    });
    await act(async () => { root.render(el()); });
    const keyWhileLoading = localStorage.getItem(KEY('B'));
    loading.delete('B');
    await act(async () => { root.render(el()); });
    const shownB = shown[shown.length - 1];
    console.log('COLD B-loading: keyWhileLoading=', keyWhileLoading, 'shown=', shownB, 'keyB=', localStorage.getItem(KEY('B')));
    await act(async () => { root.unmount(); });
    expect(keyWhileLoading).toBe('b1');
    expect(shownB).toBe('appB');
  });

  // Without the call-site key (AIScreen.tsx) the CACHED switch still cross-writes:
  // the restore effect consumes `restored` on the stale selectedId, so this bare-pane
  // defect is asserted to persist (the app is fixed by <WorkspacePane key=...>).
  it.fails("switch A->B (B cached) restores b1 — bare-pane defect, fixed by the call-site key", async () => {
    const r = await scenario(true);
    console.log('SWITCH B-cached:', JSON.stringify(r));
    expect(r.shownInA).toBe('appA');
    expect(r.keyB).toBe('b1');
    expect(r.shownInB).toBe('appB');
  });

  it("switch A->B (B loading) restores b1 and keeps B's key", async () => {
    const r = await scenario(false);
    console.log('SWITCH B-loading:', JSON.stringify(r));
    expect(r.shownInA).toBe('appA');
    expect(r.keyB).toBe('b1');
    expect(r.shownInB).toBe('appB');
  });

  // fix candidate: AIScreen.tsx:629 renders <WorkspacePane key={activeSessionId} .../>
  for (const cached of [true, false]) {
    it(`FIX key={conversationId}: switch A->B (B ${cached ? 'cached' : 'loading'}) keeps and restores b1`, async () => {
      const r = await scenario(cached, true);
      console.log(`KEYED B-${cached ? 'cached' : 'loading'}:`, JSON.stringify(r));
      expect(r.keyB).toBe('b1');
      expect(r.shownInB).toBe('appB');
    });
  }
});
