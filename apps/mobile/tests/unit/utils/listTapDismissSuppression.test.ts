import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  consumeListTapDismissSuppression,
  suppressListTapDismissKeyboard,
} from '@/src/utils/listTapDismissSuppression';

describe('listTapDismissSuppression', () => {
  it('consumes a single pending suppression', () => {
    suppressListTapDismissKeyboard();
    assert.equal(consumeListTapDismissSuppression(), true);
    assert.equal(consumeListTapDismissSuppression(), false);
  });

  it('returns false when nothing was suppressed', () => {
    assert.equal(consumeListTapDismissSuppression(), false);
  });
});
