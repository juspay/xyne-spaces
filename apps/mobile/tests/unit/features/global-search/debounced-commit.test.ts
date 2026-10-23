import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { createDebouncedCommitter } from '@/src/features/global-search/utils/debounced-commit';

/**
 * These tests pin the fix for the "results frozen on the Suggested list" bug.
 *
 * The old debouncer had no `maxWait`, so every keystroke cancelled the pending commit
 * outright. A user who never paused for the full quiet period never searched at all —
 * text visibly in the box, results stuck on the empty-query state.
 */

const WAIT_MS = 250;
const MAX_WAIT_MS = 700;

function committerWithSpy(): {
  commit: ReturnType<typeof mock.fn>;
  committer: ReturnType<typeof createDebouncedCommitter<string>>;
} {
  const commit = mock.fn();
  const committer = createDebouncedCommitter<string>(commit as (value: string) => void, {
    waitMs: WAIT_MS,
    maxWaitMs: MAX_WAIT_MS,
  });
  return { commit, committer };
}

describe('createDebouncedCommitter', () => {
  // Scoped to this suite on purpose: the runner uses --test-isolation=none, so a
  // top-level hook would enable fake timers for every test in the whole process.
  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  });

  afterEach(() => {
    mock.timers.reset();
  });

  it('commits once after the quiet period, with the latest value', () => {
    const { commit, committer } = committerWithSpy();

    committer.push('h');
    committer.push('he');
    committer.push('hel');

    assert.equal(commit.mock.callCount(), 0);

    mock.timers.tick(WAIT_MS);

    assert.equal(commit.mock.callCount(), 1);
    assert.deepEqual(commit.mock.calls[0]?.arguments, ['hel']);
  });

  it('commits while the user keeps typing, once maxWait is reached', () => {
    const { commit, committer } = committerWithSpy();

    // A keystroke every 100ms — the 250ms quiet period never elapses.
    for (let i = 1; i <= 8; i += 1) {
      committer.push('x'.repeat(i));
      mock.timers.tick(100);
    }

    // Without maxWait this would still be zero, which was exactly the bug.
    assert.equal(commit.mock.callCount(), 1);
  });

  it('starts a fresh ceiling after each commit', () => {
    const { commit, committer } = committerWithSpy();

    for (let i = 1; i <= 16; i += 1) {
      committer.push(`v${i}`);
      mock.timers.tick(100);
    }

    // 1600ms of continuous typing against a 700ms ceiling => two commits.
    assert.equal(commit.mock.callCount(), 2);
  });

  it('flush commits immediately', () => {
    const { commit, committer } = committerWithSpy();

    committer.push('now');
    committer.flush();

    assert.equal(commit.mock.callCount(), 1);
    assert.deepEqual(commit.mock.calls[0]?.arguments, ['now']);
  });

  it('flush with nothing pending does nothing', () => {
    const { commit, committer } = committerWithSpy();

    committer.flush();
    mock.timers.tick(1000);

    assert.equal(commit.mock.callCount(), 0);
  });

  it('does not commit twice when flush follows a natural fire', () => {
    const { commit, committer } = committerWithSpy();

    committer.push('a');
    mock.timers.tick(WAIT_MS);
    committer.flush();

    assert.equal(commit.mock.callCount(), 1);
  });

  it('cancel drops the pending value', () => {
    const { commit, committer } = committerWithSpy();

    committer.push('gone');
    committer.cancel();
    mock.timers.tick(1000);

    assert.equal(commit.mock.callCount(), 0);
  });

  it('works again after a cancel', () => {
    const { commit, committer } = committerWithSpy();

    committer.push('dropped');
    committer.cancel();

    committer.push('kept');
    mock.timers.tick(WAIT_MS);

    assert.equal(commit.mock.callCount(), 1);
    assert.deepEqual(commit.mock.calls[0]?.arguments, ['kept']);
  });
});
