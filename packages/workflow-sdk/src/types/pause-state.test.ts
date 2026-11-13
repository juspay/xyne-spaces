/**
 * `promptLines` is the only thing standing between an execution paused before
 * prompts became a list and a blank message — so the shape it was written for
 * is the shape worth pinning.
 */
import { describe, it, expect } from 'vitest';
import { promptLines } from './pause-state.js';

describe('what a pause says', () => {
  it('reads a list, which is what every pause written now holds', () => {
    expect(promptLines({ prompt: ['Hi!', 'What do you need?'] })).toEqual(['Hi!', 'What do you need?']);
    expect(promptLines({ prompt: [] })).toEqual([]);
  });

  it('reads the single string an execution paused before the change holds', () => {
    // Run data is not reached by a config migration, so this branch is load
    // bearing until no such execution is still open. Deleting it silently
    // empties every conversation paused across the upgrade.
    expect(promptLines({ prompt: 'Payments — which part?' })).toEqual(['Payments — which part?']);
  });

  it('says nothing for a pause that says nothing', () => {
    expect(promptLines({ prompt: '' })).toEqual([]);
    expect(promptLines({})).toEqual([]);
    expect(promptLines(undefined)).toEqual([]);
  });

  it('drops entries that are not words, rather than rendering them', () => {
    // Run data is whatever was written, years ago, by a version that is gone.
    expect(promptLines({ prompt: ['Hi!', '', 'Ok'] })).toEqual(['Hi!', 'Ok']);
    expect(promptLines({ prompt: ['Hi!', null, 7, { a: 1 }] as unknown[] })).toEqual(['Hi!']);
    expect(promptLines({ prompt: 42 })).toEqual([]);
  });
});
