import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isAgentUserType } from '@/src/features/conversation/model/agent';

describe('isAgentUserType', () => {
  it('treats bots, apps and agents as agents', () => {
    assert.equal(isAgentUserType('BOT'), true);
    assert.equal(isAgentUserType('APP'), true);
    assert.equal(isAgentUserType('AGENT'), true);
  });

  it('does not tag people or unknowns', () => {
    assert.equal(isAgentUserType('USER'), false);
    assert.equal(isAgentUserType(undefined), false);
    assert.equal(isAgentUserType(null), false);
    assert.equal(isAgentUserType(''), false);
  });
});
