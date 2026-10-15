import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeButtonVariant } from '@/src/components/ui/button/button.theme';

describe('normalizeButtonVariant', () => {
  it('maps flow button variants to app button variants', () => {
    assert.equal(normalizeButtonVariant('primary'), 'primary');
    assert.equal(normalizeButtonVariant('secondary'), 'secondary');
    assert.equal(normalizeButtonVariant('warning'), 'warning');
    assert.equal(normalizeButtonVariant('destructive'), 'danger');
    assert.equal(normalizeButtonVariant('unknown'), 'secondary');
  });
});
