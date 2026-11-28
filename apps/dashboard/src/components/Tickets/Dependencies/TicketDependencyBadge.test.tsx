// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TicketDependencyBadge } from './TicketDependencyBadge';
import { useDependencyHighlight } from '../../../hooks/useDependencyHighlight';
import type { DependencyTicketView } from '../../../services/dependencies/types';

const state = vi.hoisted(() => ({ views: new Map<string, DependencyTicketView>() }));
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user', workspaceId: 'workspace' }, isAuthenticated: true }),
}));
vi.mock('../../../hooks/useDependencyState', () => ({
  useDependencyData: () => state.views,
  useTicketDependenciesEnabled: () => true,
}));
function OtherCard() {
  return <span data-highlighted={useDependencyHighlight('blocker')} />;
}
async function flush(action: () => void) {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}

// Real badge/Radix interaction under jsdom. Layout observer, auth and REST state are mocked.
describe('dependency badge focus and click disclosure', () => {
  let root: Root;
  let container: HTMLDivElement;
  const render = () =>
    flush(() =>
      root.render(
        <>
          <TicketDependencyBadge ticketId='dependent' />
          <OtherCard />
        </>,
      ),
    );
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    state.views = new Map([
      [
        'dependent',
        {
          error: null,
          batch: {
            boards: [],
            stages: [],
            states: { dependent: { primary: 'Blocked', blockedBy: ['edge'], blocking: [] } },
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
          },
        },
      ],
    ]);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await flush(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  const highlighted = () =>
    container.querySelector('[data-highlighted]')?.getAttribute('data-highlighted');
  it('opens on keyboard focus and stays open on the first click', async () => {
    await render();
    const button = container.querySelector('button')!;
    await flush(() => button.focus());
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(highlighted()).toBe('true');
    await flush(() => button.click());
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.textContent).toContain('Visible blocker');
    await flush(() =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(highlighted()).toBe('false');
  });
  it('clears the highlight when a failed or revoked read removes the badge', async () => {
    await render();
    await flush(() => container.querySelector('button')!.click());
    expect(highlighted()).toBe('true');
    state.views = new Map();
    await render();
    expect(container.querySelector('button')).toBeNull();
    expect(highlighted()).toBe('false');
  });
});
