import { describe, expect, it } from 'vitest';
import { DependencyHighlightStore, dependencyHighlightIds } from '../highlight';
import { EMPTY_DEPENDENCY_BATCH, type DependencyBatch, type PublicDependencyEdge } from '../types';

const edge: PublicDependencyEdge = {
  id: 'edge',
  kind: 'BLOCKS',
  blockerTicketId: 'blocker',
  dependentTicketId: 'dependent',
  strength: 'SOFT',
  gatedStageId: null,
  satisfiedStageId: null,
  satisfiedAt: null,
  override: null,
  reviewNeededAt: null,
  restricted: false,
};
const ticket = (id: string) => ({
  id,
  title: id,
  xyneId: null,
  boardId: 'board',
  stageName: 'Todo',
  assignedTo: null,
  eta: null,
});
const batch: DependencyBatch = {
  ...EMPTY_DEPENDENCY_BATCH,
  edges: [edge],
  tickets: [ticket('blocker'), ticket('dependent')],
};

describe('privacy-safe related ticket highlighting', () => {
  it('highlights readable incident endpoints in either direction', () => {
    expect([...dependencyHighlightIds('dependent', batch)]).toEqual(['dependent', 'blocker']);
    expect([...dependencyHighlightIds('blocker', batch)]).toEqual(['blocker', 'dependent']);
  });
  it('includes CHILD edges without needing a separate hierarchy query', () => {
    expect(
      dependencyHighlightIds('dependent', { ...batch, edges: [{ ...edge, kind: 'CHILD' }] }),
    ).toEqual(new Set(['dependent', 'blocker']));
  });
  it('ignores restricted edges even with stale endpoint summaries', () => {
    expect(
      dependencyHighlightIds('dependent', { ...batch, edges: [{ ...edge, restricted: true }] }),
    ).toEqual(new Set(['dependent']));
  });
  it('does not highlight an endpoint missing from the current readable projection', () => {
    expect(dependencyHighlightIds('dependent', { ...batch, tickets: [] })).toEqual(
      new Set(['dependent']),
    );
  });
  it('ignores satisfied and unrelated edges', () => {
    expect(
      dependencyHighlightIds('dependent', {
        ...batch,
        edges: [
          { ...edge, satisfiedAt: '2026-11-28' },
          {
            ...edge,
            id: 'unrelated',
            blockerTicketId: 'other',
            dependentTicketId: 'blocker',
          },
        ],
      }),
    ).toEqual(new Set(['dependent']));
  });
  it('never promotes an opaque restricted token into a highlighted endpoint', () => {
    const id = 'restricted:opaque';
    expect(
      dependencyHighlightIds('dependent', {
        ...batch,
        edges: [{ ...edge, blockerTicketId: id }],
        tickets: [ticket(id)],
      }),
    ).toEqual(new Set(['dependent']));
  });
});

describe('transient highlight ownership', () => {
  it('isolates workspace and user identities', () => {
    const store = new DependencyHighlightStore();
    store.activate('workspace:user', Symbol(), new Set(['ticket']));
    expect(store.contains('workspace:user', 'ticket')).toBe(true);
    expect(store.contains('other-workspace:user', 'ticket')).toBe(false);
    expect(store.contains('workspace:other-user', 'ticket')).toBe(false);
    expect(store.contains(null, 'ticket')).toBe(false);
  });
  it('old cleanup cannot erase the latest popup', () => {
    const store = new DependencyHighlightStore();
    const oldCleanup = store.activate('scope', Symbol(), new Set(['old']));
    const newCleanup = store.activate('scope', Symbol(), new Set(['new']));
    oldCleanup();
    expect(store.contains('scope', 'new')).toBe(true);
    expect(store.contains('scope', 'old')).toBe(false);
    newCleanup();
    expect(store.contains('scope', 'new')).toBe(false);
  });
  it('copies caller-owned sets and releases subscriptions', () => {
    const store = new DependencyHighlightStore();
    let updates = 0;
    const unsubscribe = store.subscribe(() => {
      updates++;
    });
    const ids = new Set(['ticket']);
    const cleanup = store.activate('scope', Symbol(), ids);
    ids.clear();
    expect(store.contains('scope', 'ticket')).toBe(true);
    expect(updates).toBe(1);
    unsubscribe();
    cleanup();
    expect(updates).toBe(1);
    expect(store.contains('scope', 'ticket')).toBe(false);
  });
});
