import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  armGuideReturn,
  clearGuideReturn,
  getGuideReturnTarget,
  subscribeGuideReturn,
} from '@/src/features/user-guide/guide-return-store';

describe('guide return store', () => {
  beforeEach(() => {
    clearGuideReturn();
  });

  it('starts empty and remembers the armed guide', () => {
    assert.equal(getGuideReturnTarget(), null);
    armGuideReturn({ guideId: 'gestures', title: 'Gestures you should know' });
    assert.deepEqual(getGuideReturnTarget(), {
      guideId: 'gestures',
      title: 'Gestures you should know',
    });
  });

  it('notifies subscribers on arm and clear, and not on no-op repeats', () => {
    let calls = 0;
    const unsubscribe = subscribeGuideReturn(() => {
      calls += 1;
    });

    armGuideReturn({ guideId: 'a', title: 'A' });
    armGuideReturn({ guideId: 'a', title: 'A' });
    clearGuideReturn();
    clearGuideReturn();

    assert.equal(calls, 2);
    unsubscribe();

    armGuideReturn({ guideId: 'b', title: 'B' });
    assert.equal(calls, 2);
  });

  it('replaces the target when a different guide is armed', () => {
    armGuideReturn({ guideId: 'a', title: 'A' });
    armGuideReturn({ guideId: 'b', title: 'B' });
    assert.equal(getGuideReturnTarget()?.guideId, 'b');
  });
});
