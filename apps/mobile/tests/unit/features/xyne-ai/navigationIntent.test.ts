import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { knownActions, resolve, type JevRoute } from '@/src/features/xyne-ai/navigation/intent';

describe('knownActions', () => {
  const known = new Map([
    ['open_dm', 'dm'],
    ['open_settings', 'settings'],
  ]);

  it('takes every id we know, best first, once', () => {
    const response: JevRoute = {
      route: 'actions',
      actionIds: ['made_up', 'open_settings', 'open_dm', 'open_settings'],
      confidence: 0.9,
    };
    assert.deepEqual(knownActions(response, known), ['settings', 'dm']);
  });

  it('finds nothing when no id is ours or the route is not actions', () => {
    assert.deepEqual(
      knownActions({ route: 'actions', actionIds: ['x'], confidence: 1 }, known),
      [],
    );
    assert.deepEqual(knownActions({ route: 'ask_ai', reason: 'question' }, known), []);
    assert.deepEqual(knownActions({ route: 'unavailable' }, known), []);
  });
});

describe('resolve', () => {
  const person = (name: string): { name: string } => ({ name });

  it('opens a single match', () => {
    assert.deepEqual(resolve('ann', [person('Ann Lee')]), {
      kind: 'one',
      match: person('Ann Lee'),
    });
  });

  it('prefers the one exact name among look-alikes', () => {
    const matches = [person('Anna'), person('Ann'), person('Joanne')];
    assert.deepEqual(resolve('ann', matches), { kind: 'one', match: person('Ann') });
  });

  it('matches channels with or without #', () => {
    assert.equal(resolve('#general', [person('general'), person('general-2')]).kind, 'one');
  });

  it('offers several matches, capped', () => {
    const matches = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(person);
    const result = resolve('x', matches);
    assert.equal(result.kind, 'many');
    assert.equal(result.kind === 'many' && result.matches.length, 5);
  });

  it('finds nothing for no matches', () => {
    assert.deepEqual(resolve('ann', []), { kind: 'none' });
  });
});
