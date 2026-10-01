import { describe, expect, it } from 'vitest';
import { calculatePollResults } from './pollResults';

describe('calculatePollResults', () => {
  it('returns zero percentages when nobody has voted', () => {
    expect(calculatePollResults([{ id: 'a' }, { id: 'b' }], [], 'me')).toEqual({
      voterCount: 0,
      currentSelections: [],
      options: [
        { optionId: 'a', count: 0, percentage: 0 },
        { optionId: 'b', count: 0, percentage: 0 },
      ],
    });
  });

  it('counts ballots, percentages, distinct voters, and current selections', () => {
    expect(
      calculatePollResults(
        [{ id: 'a' }, { id: 'b' }],
        [
          { userId: 'me', optionIds: ['a', 'b'] },
          { userId: 'other', optionIds: ['b'] },
        ],
        'me',
      ),
    ).toEqual({
      voterCount: 2,
      currentSelections: ['a', 'b'],
      options: [
        { optionId: 'a', count: 1, percentage: 50 },
        { optionId: 'b', count: 2, percentage: 100 },
      ],
    });
  });

  it("counts another user's vote without marking it as the current user's selection", () => {
    expect(
      calculatePollResults(
        [{ id: 'goa' }, { id: 'coorg' }],
        [{ userId: 'other-user', optionIds: ['coorg'] }],
        'current-user',
      ),
    ).toEqual({
      voterCount: 1,
      currentSelections: [],
      options: [
        { optionId: 'goa', count: 0, percentage: 0 },
        { optionId: 'coorg', count: 1, percentage: 100 },
      ],
    });
  });
});
