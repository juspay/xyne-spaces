import {
  resolveAssignedWikiCommitRef,
  shortestUniqueWikiCommitRef,
  wikiAgentCommitRef,
  wikiAssignmentView,
} from '../../../src/sdlc/wiki/wikiCommitRefs';

describe('Wiki commit references', () => {
  it('uses a minimum of nine characters and extends colliding prefixes', () => {
    const first = `${'a'.repeat(9)}1${'0'.repeat(30)}`;
    const second = `${'a'.repeat(9)}2${'0'.repeat(30)}`;
    expect(shortestUniqueWikiCommitRef(first, [first, second])).toBe(`${'a'.repeat(9)}1`);
    expect(shortestUniqueWikiCommitRef('b'.repeat(40), [first, second])).toBe('b'.repeat(9));
  });

  it('resolves only unique assigned prefixes to their canonical full SHA', () => {
    const first = `${'a'.repeat(9)}1${'0'.repeat(30)}`;
    const second = `${'a'.repeat(9)}2${'0'.repeat(30)}`;
    expect(resolveAssignedWikiCommitRef(`${'a'.repeat(9)}1`, [first, second])).toBe(first);
    expect(resolveAssignedWikiCommitRef('a'.repeat(9), [first, second])).toBeNull();
    expect(resolveAssignedWikiCommitRef('b'.repeat(9), [first, second])).toBeNull();
    expect(resolveAssignedWikiCommitRef(first, [first, second])).toBe(first);
  });

  it('accepts the synthetic root ref only when it is assigned', () => {
    expect(resolveAssignedWikiCommitRef('ROOT_BOOTSTRAP', ['ROOT_BOOTSTRAP'])).toBe(
      'ROOT_BOOTSTRAP'
    );
    expect(resolveAssignedWikiCommitRef('ROOT_BOOTSTRAP', [])).toBeNull();
  });

  it('exposes the durable next assignment with only an abbreviated ref', () => {
    const first = 'a'.repeat(40);
    const second = 'b'.repeat(40);
    expect(
      wikiAssignmentView({
        selectedCommitShas: [first, second],
        bootstrapRef: 'ROOT_BOOTSTRAP',
        targetHeadSha: second,
        cursorSha: first,
        assignedChunk: {
          kind: 'COMMITS',
          commitShas: [first, second],
          nextIndex: 1,
        },
        pendingCommit: { commitSha: second, pages: [{ path: 'overview.md' }] },
      })
    ).toEqual({
      kind: 'COMMITS',
      currentCommitRef: 'b'.repeat(9),
      completedInChunk: 1,
      totalInChunk: 2,
      pendingPagePaths: ['overview.md'],
    });
  });

  it('reports no assignment after the durable chunk is complete', () => {
    expect(
      wikiAssignmentView({
        selectedCommitShas: ['a'.repeat(40)],
        assignedChunk: null,
      })
    ).toBeNull();
  });

  it('exposes a compact server-authored history window and active checkpoint', () => {
    const first = 'a'.repeat(40);
    const second = 'b'.repeat(40);
    const third = 'c'.repeat(40);
    expect(
      wikiAssignmentView({
        selectedCommitShas: [first, second, third],
        bootstrapRef: 'ROOT_BOOTSTRAP',
        targetHeadSha: third,
        cursorSha: null,
        assignedChunk: {
          kind: 'COMMITS',
          commitShas: [first, second, third],
          nextIndex: 0,
          window: {
            beforeSha: 'ROOT_BOOTSTRAP',
            afterSha: third,
            activeCheckpointSha: second,
            completedCheckpointShas: [],
          },
        },
        pendingCommit: { commitSha: second, pages: [{ path: 'flows/payments.md' }] },
      })
    ).toEqual({
      kind: 'COMMITS',
      currentCommitRef: 'b'.repeat(9),
      completedInChunk: 0,
      totalInChunk: 3,
      pendingPagePaths: ['flows/payments.md'],
      window: {
        beforeRef: 'ROOT_BOOTSTRAP',
        afterRef: 'c'.repeat(9),
        includedRefs: ['a'.repeat(9), 'b'.repeat(9), 'c'.repeat(9)],
        activeCheckpointRef: 'b'.repeat(9),
        completedCheckpointRefs: [],
      },
    });
  });

  it('never exposes a canonical full SHA through the agent commit view', () => {
    const sha = 'c'.repeat(40);
    expect(wikiAgentCommitRef(sha, { selectedCommitShas: [sha] })).toBe('c'.repeat(9));
    expect(wikiAgentCommitRef('ROOT_BOOTSTRAP', { selectedCommitShas: [] })).toBe(
      'ROOT_BOOTSTRAP'
    );
    expect(wikiAgentCommitRef(null, { selectedCommitShas: [] })).toBeNull();
    expect(wikiAgentCommitRef('stale-import-value', { selectedCommitShas: [] })).toBeNull();
  });
});
