import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AUTO_MODEL_DESCRIPTION,
  autoModelDescription,
  filterModels,
  formatModelLabel,
  modelPillLabel,
  modelSummary,
} from '@/src/features/xyne-ai/model/modelSelection';

const sonnet = { id: 'claude-sonnet-4-20250514', name: 'Sonnet 4', description: 'Fast' };
const plain = { id: 'gpt-4o' };

describe('model labels', () => {
  it('strips a trailing release stamp only', () => {
    assert.equal(formatModelLabel('claude-sonnet-4-20250514'), 'claude-sonnet-4');
    assert.equal(formatModelLabel('gpt-4o'), 'gpt-4o');
  });

  it('shows Auto, the catalog name, or the cleaned id', () => {
    assert.equal(modelPillLabel(undefined), 'Auto');
    assert.equal(modelPillLabel(sonnet), 'Sonnet 4');
    assert.equal(modelPillLabel({ id: 'm-20250514' }), 'm');
  });

  it('summarises the choice', () => {
    assert.equal(modelSummary(undefined), AUTO_MODEL_DESCRIPTION);
    assert.equal(modelSummary(sonnet), 'Fast');
    assert.equal(modelSummary(plain), 'Every message in this chat runs on gpt-4o');
    assert.equal(autoModelDescription('Sonnet 4'), 'Uses Sonnet 4 by default');
    assert.equal(autoModelDescription(undefined), AUTO_MODEL_DESCRIPTION);
  });

  it('filters by id or name', () => {
    assert.deepEqual(filterModels([sonnet, plain], 'SONNET'), [sonnet]);
    assert.deepEqual(filterModels([sonnet, plain], ''), [sonnet, plain]);
  });
});
