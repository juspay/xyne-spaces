// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDependencyHighlight, useDependencyHighlightSource } from './useDependencyHighlight';
import type { DependencyBatch } from '../services/dependencies/types';

const auth = vi.hoisted(() => ({
  user: { id: 'user', workspaceId: 'workspace' },
  isAuthenticated: true,
  enabled: true,
}));
vi.mock('./useAuth', () => ({ useAuth: () => auth }));
vi.mock('./useDependencyState', () => ({ useTicketDependenciesEnabled: () => auth.enabled }));
const batch: DependencyBatch = {
  boards: [],
  stages: [],
  states: {},
  tickets: [
    {
      id: 'blocker',
      title: 'Visible blocker',
      xyneId: null,
      boardId: 'board',
      stageName: 'Todo',
      assignedTo: null,
      eta: null,
    },
  ],
  edges: [
    {
      id: 'edge',
      kind: 'BLOCKS',
      blockerTicketId: 'blocker',
      dependentTicketId: 'dependent',
      strength: 'SOFT',
      gatedStageId: null,
      satisfiedStageId: null,
      satisfiedAt: null,
      reviewNeededAt: null,
      override: null,
      restricted: false,
    },
  ],
};
function Source({ open, value }: { open: boolean; value?: DependencyBatch }) {
  useDependencyHighlightSource('dependent', value, open);
  return null;
}
function Card({ id }: { id: string }) {
  const highlighted = useDependencyHighlight(id);
  return <span data-ticket={id} data-highlighted={highlighted} />;
}
async function flush(action: () => void) {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}

// Mounted hooks with mocked auth/feature flags, not browser or live ACL acceptance.
describe('related-ticket highlight hook ownership', () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    auth.user = { id: 'user', workspaceId: 'workspace' };
    auth.isAuthenticated = true;
    auth.enabled = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await flush(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  const highlighted = (id: string) =>
    container.querySelector(`[data-ticket="${id}"]`)?.getAttribute('data-highlighted') === 'true';
  const render = (open: boolean, value: DependencyBatch = batch, source = true) =>
    flush(() =>
      root.render(
        <StrictMode>
          {source && <Source open={open} value={value} />}
          <Card id='blocker' />
          <Card id='dependent' />
          <Card id='unrelated' />
        </StrictMode>,
      ),
    );
  it('highlights related mounted views and clears on close in StrictMode', async () => {
    await render(true);
    expect(highlighted('blocker')).toBe(true);
    expect(highlighted('dependent')).toBe(true);
    expect(highlighted('unrelated')).toBe(false);
    await render(false);
    expect(highlighted('blocker')).toBe(false);
  });
  it('clears when the source unmounts', async () => {
    await render(true);
    await render(true, batch, false);
    expect(highlighted('blocker')).toBe(false);
  });
  it('drops a revoked endpoint even if its stale summary remains', async () => {
    await render(true);
    await render(true, { ...batch, edges: [{ ...batch.edges[0]!, restricted: true }] });
    expect(highlighted('blocker')).toBe(false);
  });
  it('clears on logout, flag disable and identity changes', async () => {
    await render(true);
    auth.isAuthenticated = false;
    await render(true);
    expect(highlighted('blocker')).toBe(false);
    auth.isAuthenticated = true;
    auth.enabled = false;
    await render(true);
    expect(highlighted('blocker')).toBe(false);
    auth.enabled = true;
    await render(true);
    expect(highlighted('blocker')).toBe(true);
    // Source unmount and destination identity switch occur in the same render.
    auth.user = { id: 'other-user', workspaceId: 'other-workspace' };
    await render(true, batch, false);
    expect(highlighted('blocker')).toBe(false);
  });
});
