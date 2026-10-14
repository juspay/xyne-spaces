import test from 'node:test';
import assert from 'node:assert/strict';

import { aggregatePollBallots, buildPollRows } from '../dist/polls/index.js';

const draft = {
  pollId: 'poll-1',
  allowAudienceChoices: true,
  isAnonymous: false,
  resultVisibility: 'AFTER_CLOSE',
  questions: [
    {
      id: 'q1',
      question: 'Lunch?',
      responseType: 'SINGLE_CHOICE',
      options: [
        { id: 'a', text: 'Tea' },
        { id: 'b', text: 'Coffee' },
      ],
    },
    { id: 'q2', question: 'Why?', responseType: 'SHORT_TEXT', options: [] },
  ],
};

test('builds one poll, ordered questions with their options, and empty results', () => {
  const rows = buildPollRows({
    draft,
    messageId: 'm1',
    workspaceId: 'w1',
    userId: 'u1',
    timestamp: 1_000,
    schedule: { closeAt: '1970-01-01T00:00:05.000Z', remindAt: null },
  });

  assert.deepEqual(rows.poll, {
    id: 'poll-1',
    workspaceId: 'w1',
    messageId: 'm1',
    createdBy: 'u1',
    allowAudienceChoices: true,
    isAnonymous: false,
    resultVisibility: 'AFTER_CLOSE',
    closesAt: 5_000,
    remindAt: null,
    closedAt: null,
    createdAt: 1_000,
  });
  assert.deepEqual(
    rows.questions.map(({ id, position, options }) => ({ id, position, options })),
    [
      {
        id: 'q1',
        position: 0,
        options: [
          { id: 'a', text: 'Tea', createdBy: 'u1' },
          { id: 'b', text: 'Coffee', createdBy: 'u1' },
        ],
      },
      { id: 'q2', position: 1, options: [] },
    ],
  );
  assert.deepEqual(
    rows.results.map(({ questionId, voterCount, optionCounts, rankTotals, ratingTotal }) => ({
      questionId,
      voterCount,
      optionCounts,
      rankTotals,
      ratingTotal,
    })),
    [
      { questionId: 'q1', voterCount: 0, optionCounts: {}, rankTotals: {}, ratingTotal: 0 },
      { questionId: 'q2', voterCount: 0, optionCounts: {}, rankTotals: {}, ratingTotal: 0 },
    ],
  );
});

test('rejects close and reminder times that are not in the future', () => {
  const input = { draft, messageId: 'm1', workspaceId: 'w1', userId: 'u1', timestamp: 5_000 };
  assert.throws(
    () => buildPollRows({ ...input, schedule: { closeAt: '1970-01-01T00:00:05.000Z' } }),
    /close time must be in the future/,
  );
  assert.throws(
    () => buildPollRows({ ...input, schedule: { remindAt: '1970-01-01T00:00:01.000Z' } }),
    /reminder time must be in the future/,
  );
});

test('aggregates choice counts, rank totals and rating totals from ballots', () => {
  assert.deepEqual(
    aggregatePollBallots([
      { optionIds: ['a', 'b'] },
      { optionIds: ['a'] },
      { optionIds: [], rankedOptionIds: ['b', 'a'] },
      { optionIds: [], rating: 4 },
      { optionIds: [], rating: 2, rankedOptionIds: null },
    ]),
    {
      voterCount: 5,
      optionCounts: { a: 2, b: 1 },
      rankTotals: { b: 1, a: 2 },
      ratingTotal: 6,
    },
  );
  assert.deepEqual(aggregatePollBallots([]), {
    voterCount: 0,
    optionCounts: {},
    rankTotals: {},
    ratingTotal: 0,
  });
});
