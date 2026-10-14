import { describe, expect, it } from 'vitest';
import { buildPollResponseDetails, buildPollVoterDetails } from './pollVoterDetails';

const options = [
  { id: 'goa', text: 'Goa' },
  { id: 'coorg', text: 'Coorg' },
];
const ballots = [
  { userId: 'user-1', optionIds: ['goa', 'coorg'] },
  { userId: 'user-2', optionIds: ['coorg'] },
];
const usersById = new Map([
  ['user-1', { displayName: 'Asha' }],
  ['user-2', { name: 'Bharat' }],
]);

describe('buildPollVoterDetails', () => {
  it('groups voter names by option', () => {
    expect(buildPollVoterDetails({ options, ballots, usersById })).toEqual([
      { optionId: 'goa', optionText: 'Goa', voters: [{ userId: 'user-1', name: 'Asha' }] },
      {
        optionId: 'coorg',
        optionText: 'Coorg',
        voters: [
          { userId: 'user-1', name: 'Asha' },
          { userId: 'user-2', name: 'Bharat' },
        ],
      },
    ]);
  });
});

describe('buildPollResponseDetails', () => {
  it('formats text, rating, and ranking answers', () => {
    const common = { options, usersById };

    expect(
      buildPollResponseDetails({
        ...common,
        responseType: 'SHORT_TEXT',
        ballots: [{ userId: 'user-1', optionIds: [], textAnswer: 'Remote' }],
      }),
    ).toEqual([{ userId: 'user-1', name: 'Asha', answer: 'Remote' }]);
    expect(
      buildPollResponseDetails({
        ...common,
        responseType: 'RATING_1_TO_5',
        ballots: [{ userId: 'user-2', optionIds: [], rating: 4 }],
      }),
    ).toEqual([{ userId: 'user-2', name: 'Bharat', answer: '4/5' }]);
    expect(
      buildPollResponseDetails({
        ...common,
        responseType: 'RANKING',
        ballots: [{ userId: 'user-1', optionIds: [], rankedOptionIds: ['coorg', 'goa'] }],
      }),
    ).toEqual([{ userId: 'user-1', name: 'Asha', answer: '1. Coorg, 2. Goa' }]);
  });
});
