import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { firstName, greeting } from '@/src/features/xyne-ai/model/greeting';

const at = (hour: number): Date => new Date(2026, 0, 1, hour);

describe('greeting', () => {
  it('follows the hour of day', () => {
    assert.equal(greeting(at(3), undefined), 'Working late');
    assert.equal(greeting(at(9), 'Om'), 'Good morning, Om');
    assert.equal(greeting(at(16), undefined), 'Good afternoon');
    assert.equal(greeting(at(20), 'Om'), 'Good evening, Om');
  });
});

describe('firstName', () => {
  it('prefers the profile name, then the email local part', () => {
    assert.equal(firstName('om kumar', 'x@y.z'), 'Om');
    assert.equal(firstName('', 'krishan.saini@juspay.in'), 'Krishan');
    assert.equal(firstName(undefined, undefined), undefined);
  });
});
