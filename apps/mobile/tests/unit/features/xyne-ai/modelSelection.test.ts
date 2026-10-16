import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { autoModelDescription, modelPillLabel } from '@/src/features/xyne-ai/model/modelSelection';

const AUTO_DESCRIPTION = 'Balanced quality and speed recommended for most tasks';
const sonnet = { id: 'claude-sonnet-4-20250514', name: 'Sonnet 4', description: 'Fast' };
const plain = { id: 'gpt-4o' };

describe('model labels', () => {
  it('shows Auto, the catalog name, or the cleaned id', () => {
    assert.equal(modelPillLabel(undefined), 'Auto');
    assert.equal(modelPillLabel(sonnet), 'Sonnet 4');
    assert.equal(modelPillLabel({ id: 'm-20250514' }), 'm');
    assert.equal(modelPillLabel(plain), 'gpt-4o');
  });

  it('describes the Auto choice', () => {
    assert.equal(autoModelDescription('Sonnet 4'), 'Uses Sonnet 4 by default');
    assert.equal(autoModelDescription(undefined), AUTO_DESCRIPTION);
  });
});
