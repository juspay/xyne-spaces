import { describe, expect, it } from 'vitest';
import { calculatePollResults, calculateRankingResult, calculateRatingResult } from './pollResults';

describe('calculatePollResults', () => {
  it('returns zero percentages when nobody has voted', () => {
    expect(calculatePollResults([{ id: 'a' }, { id: 'b' }], null, [])).toEqual({
      voterCount: 0,
      currentSelections: [],
      options: [
        { optionId: 'a', count: 0, percentage: 0 },
        { optionId: 'b', count: 0, percentage: 0 },
      ],
    });
  });

  it('combines aggregate totals with only the current users ballot', () => {
    expect(
      calculatePollResults(
        [{ id: 'a' }, { id: 'b' }],
        { voterCount: 2, optionCounts: { a: 1, b: 2 } },
        [{ optionIds: ['a', 'b'] }],
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

  it("shows another user's aggregate without marking it as the current user's selection", () => {
    expect(
      calculatePollResults(
        [{ id: 'goa' }, { id: 'coorg' }],
        { voterCount: 1, optionCounts: { coorg: 1 } },
        [],
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

describe('typed poll results', () => {
  it('calculates a rating average and distribution', () => {
    expect(
      calculateRatingResult({
        responseCount: 3,
        ratingTotal: 12,
        ratingCounts: { 3: 1, 4: 1, 5: 1 },
      }),
    ).toEqual({
      responseCount: 3,
      average: 4,
      counts: [
        { rating: 1, count: 0 },
        { rating: 2, count: 0 },
        { rating: 3, count: 1 },
        { rating: 4, count: 1 },
        { rating: 5, count: 1 },
      ],
    });
  });

  it('orders ranking choices by aggregate score', () => {
    expect(
      calculateRankingResult([{ id: 'a' }, { id: 'b' }], {
        rankTotals: { a: 2, b: 5 },
        rankResponseCount: 2,
      }),
    ).toEqual([
      { optionId: 'a', totalRank: 2, averageRank: 1 },
      { optionId: 'b', totalRank: 5, averageRank: 2.5 },
    ]);
  });
});
