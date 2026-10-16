import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMenuDismissScheduler } from '@/src/features/chat/channel-members/present-after-menu-dismiss';

describe('createMenuDismissScheduler', () => {
  it('runs the callback after the current interaction finishes', () => {
    const queued: Array<() => void> = [];
    const scheduler = createMenuDismissScheduler(callback => {
      queued.push(callback);
      return { cancel: () => {} };
    });
    const presented: string[] = [];

    scheduler.schedule(() => presented.push('sheet'));
    assert.deepEqual(presented, []);

    queued[0]?.();
    assert.deepEqual(presented, ['sheet']);
  });

  it('cancels a pending present so it cannot fire after navigation', () => {
    const queued: Array<() => void> = [];
    const scheduler = createMenuDismissScheduler(callback => {
      let alive = true;
      queued.push(() => {
        if (alive) callback();
      });
      return {
        cancel: () => {
          alive = false;
        },
      };
    });
    const presented: string[] = [];

    scheduler.schedule(() => presented.push('sheet'));
    scheduler.cancel();
    queued.forEach(run => run());
    assert.deepEqual(presented, []);
  });

  it('replaces a pending present when a later remove is requested', () => {
    const queued: Array<() => void> = [];
    const scheduler = createMenuDismissScheduler(callback => {
      queued.push(callback);
      return { cancel: () => queued.splice(queued.indexOf(callback), 1) };
    });
    const presented: string[] = [];

    scheduler.schedule(() => presented.push('first'));
    scheduler.schedule(() => presented.push('second'));
    queued.forEach(run => run());
    assert.deepEqual(presented, ['second']);
  });
});
