import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { flowActionValuesFor } from '../rows/parts/flowActionValues';

const flow = (values: Record<string, unknown>) =>
  ({
    components: [],
    state: { values },
  }) as never;

describe('flowActionValuesFor', (): void => {
  it('removes blank user-question answers before a network action', (): void => {
    const values = flowActionValuesFor(
      flow({
        answers: {
          first: '  yes  ',
          second: '   ',
          third: [],
          fourth: [' a ', '', 4],
        },
      }),
    );

    assert.deepEqual(values, {
      answers: {
        first: 'yes',
        fourth: ['a'],
      },
    });
  });

  it('preserves implicit values and flows without answers', (): void => {
    const values = flowActionValuesFor(flow({ ready: true }));
    assert.deepEqual(values, { ready: true });
  });
});
