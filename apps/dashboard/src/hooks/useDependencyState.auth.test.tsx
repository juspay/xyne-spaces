// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDependencyData } from './useDependencyState';
import type { DependencyBatch } from '../services/dependencies/types';

const auth = vi.hoisted(() => ({
  user: { id: 'user', workspaceId: 'workspace' },
  isAuthenticated: true,
}));
const api = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./useAuth', () => ({ useAuth: () => auth }));
vi.mock('posthog-js', () => ({ default: { onFeatureFlags: () => () => {} } }));
vi.mock('../services/Analytics/posthogService', () => ({
  posthogService: { isFeatureEnabled: () => true },
}));
vi.mock('../services/dependencies/api', () => ({
  dependencyApi: api,
  subscribeDependencyInvalidation: () => () => {},
}));
function Probe() {
  const data = useDependencyData(['ticket']);
  return <span>{data.get('ticket')?.batch.tickets[0]?.title ?? 'empty'}</span>;
}
let root: Root;
let container: HTMLDivElement;
const render = () =>
  act(async () => {
    root.render(<Probe />);
    await Promise.resolve();
  });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  auth.isAuthenticated = true;
  const batch: DependencyBatch = {
    edges: [],
    boards: [],
    stages: [],
    states: { ticket: null },
    tickets: [
      {
        id: 'ticket',
        title: 'Readable title',
        xyneId: null,
        boardId: 'board',
        stageName: 'Todo',
        assignedTo: null,
        eta: null,
      },
    ],
  };
  api.read.mockResolvedValue(batch);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
    await Promise.resolve();
  });
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it('drops the cached projection when auth is lost even if the old user object remains', async () => {
  await render();
  expect(container.textContent).toBe('Readable title');
  expect(api.read).toHaveBeenCalledTimes(1);
  auth.isAuthenticated = false;
  await render();
  expect(container.textContent).toBe('empty');
  expect(api.read).toHaveBeenCalledTimes(1);
});
it('does not subscribe while unauthenticated with a retained user', async () => {
  auth.isAuthenticated = false;
  await render();
  expect(container.textContent).toBe('empty');
  expect(api.read).not.toHaveBeenCalled();
});
