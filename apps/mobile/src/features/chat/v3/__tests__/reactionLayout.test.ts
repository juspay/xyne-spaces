import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { visibleReactionGroupCount } from '../model/reactionLayout';

describe('visibleReactionGroupCount', (): void => {
  it('shows one group before the bubble has been measured', (): void => {
    assert.equal(visibleReactionGroupCount(0, 12), 1);
  });

  it('accounts for the count label and pill insets', (): void => {
    assert.equal(visibleReactionGroupCount(60, 12), 1);
    assert.equal(visibleReactionGroupCount(116, 12), 4);
    assert.equal(visibleReactionGroupCount(200, 12), 4);
  });

  it('does not reserve count width for a single reaction', (): void => {
    assert.equal(visibleReactionGroupCount(94, 1), 4);
  });
});
