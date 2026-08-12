import {
  nextWikiWindow,
  nextWikiChunk,
  planInitialWikiRange,
  planRefreshWikiRange,
  type FirstParentCommit,
  WIKI_ROOT_BOOTSTRAP_REF,
} from '../../../src/sdlc/wiki/wikiRangePolicy';

function chain(length: number): FirstParentCommit[] {
  return Array.from({ length }, (_, index) => ({
    sha: String(index + 1).padStart(40, '0'),
    parentSha: index === 0 ? null : String(index).padStart(40, '0'),
  }));
}

describe('Wiki first-parent range policy', () => {
  it('selects the newest ceiling percentage with at least one commit', () => {
    const commits = chain(11);
    const plan = planInitialWikiRange({
      commits,
      targetHeadSha: commits[10].sha,
      historyRange: { kind: 'LAST_PERCENT', percent: 20 },
    });

    expect(plan.selectedCommitShas).toEqual(commits.slice(8).map(({ sha }) => sha));
    expect(plan.bootstrapRef).toBe(commits[7].sha);

    const single = chain(1);
    expect(
      planInitialWikiRange({
        commits: single,
        targetHeadSha: single[0].sha,
        historyRange: { kind: 'LAST_PERCENT', percent: 20 },
      }).selectedCommitShas
    ).toHaveLength(1);
  });

  it('uses the root bootstrap sentinel for a full range', () => {
    const commits = chain(4);
    const plan = planInitialWikiRange({
      commits,
      targetHeadSha: commits[3].sha,
      historyRange: { kind: 'FULL' },
    });

    expect(plan.selectedStartSha).toBe(commits[0].sha);
    expect(plan.bootstrapRef).toBe(WIKI_ROOT_BOOTSTRAP_REF);
  });

  it('accepts an ancestor custom SHA and rejects a foreign SHA', () => {
    const commits = chain(5);
    expect(
      planInitialWikiRange({
        commits,
        targetHeadSha: commits[4].sha,
        historyRange: { kind: 'CUSTOM_SHA', sha: commits[2].sha },
      }).selectedCommitShas
    ).toEqual(commits.slice(2).map(({ sha }) => sha));

    expect(() =>
      planInitialWikiRange({
        commits,
        targetHeadSha: commits[4].sha,
        historyRange: { kind: 'CUSTOM_SHA', sha: 'f'.repeat(40) },
      })
    ).toThrow('not on the target head first-parent chain');
  });

  it('rejects a target-head change and a broken first-parent chain', () => {
    const commits = chain(3);
    expect(() =>
      planInitialWikiRange({
        commits,
        targetHeadSha: 'f'.repeat(40),
        historyRange: { kind: 'FULL' },
      })
    ).toThrow('Target head does not match');

    const broken = [...commits];
    broken[2] = { ...broken[2], parentSha: null };
    expect(() =>
      planInitialWikiRange({
        commits: broken,
        targetHeadSha: broken[2].sha,
        historyRange: { kind: 'FULL' },
      })
    ).toThrow('Broken first-parent chain');
  });

  it('refreshes strictly after the durable cursor and returns null at head', () => {
    const commits = chain(5);
    expect(
      planRefreshWikiRange({
        commits,
        cursorSha: commits[2].sha,
        targetHeadSha: commits[4].sha,
      })?.selectedCommitShas
    ).toEqual([commits[3].sha, commits[4].sha]);
    expect(
      planRefreshWikiRange({
        commits,
        cursorSha: commits[4].sha,
        targetHeadSha: commits[4].sha,
      })
    ).toBeNull();
  });

  it('returns the next bounded chunk after the cursor', () => {
    const commits = chain(5).map(({ sha }) => sha);
    expect(nextWikiChunk({ selectedCommitShas: commits, cursorSha: null, chunkSize: 2 })).toEqual(
      commits.slice(0, 2)
    );
    expect(
      nextWikiChunk({ selectedCommitShas: commits, cursorSha: commits[1], chunkSize: 2 })
    ).toEqual(commits.slice(2, 4));
    expect(() =>
      nextWikiChunk({
        selectedCommitShas: commits,
        cursorSha: 'f'.repeat(40),
        chunkSize: 2,
      })
    ).toThrow('outside the selected commit range');
  });

  it('plans one history window from durable before-state to its endpoint', () => {
    const commits = chain(5).map(({ sha }) => sha);

    expect(
      nextWikiWindow({
        selectedCommitShas: commits,
        cursorSha: null,
        bootstrapRef: 'ROOT_BOOTSTRAP',
        windowSize: 2,
      })
    ).toEqual({
      beforeSha: 'ROOT_BOOTSTRAP',
      afterSha: commits[1],
      includedCommitShas: commits.slice(0, 2),
    });
    expect(
      nextWikiWindow({
        selectedCommitShas: commits,
        cursorSha: commits[1],
        bootstrapRef: 'ROOT_BOOTSTRAP',
        windowSize: 2,
      })
    ).toEqual({
      beforeSha: commits[1],
      afterSha: commits[3],
      includedCommitShas: commits.slice(2, 4),
    });
    expect(
      nextWikiWindow({
        selectedCommitShas: commits,
        cursorSha: commits[3],
        bootstrapRef: 'ROOT_BOOTSTRAP',
        windowSize: 2,
      })
    ).toEqual({
      beforeSha: commits[3],
      afterSha: commits[4],
      includedCommitShas: [commits[4]],
    });
  });

  it('plans the expected 20 percent and 25-commit sessions for a 7k history', () => {
    const commits = chain(7_000);
    const plan = planInitialWikiRange({
      commits,
      targetHeadSha: commits[6_999].sha,
      historyRange: { kind: 'LAST_PERCENT', percent: 20 },
    });

    expect(plan.selectedCommitShas).toHaveLength(1_400);
    expect(plan.bootstrapRef).toBe(commits[5_599].sha);

    const processed: string[] = [];
    let cursorSha: string | null = null;
    while (processed.length < plan.selectedCommitShas.length) {
      const chunk = nextWikiChunk({
        selectedCommitShas: plan.selectedCommitShas,
        cursorSha,
        chunkSize: 25,
      });
      expect(chunk.length).toBeLessThanOrEqual(25);
      processed.push(...chunk);
      cursorSha = chunk.at(-1) ?? cursorSha;
    }

    expect(processed).toEqual(plan.selectedCommitShas);
    expect(processed.length / 25).toBe(56);
  });
});
