import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPollMessageSummary,
  isPollClosedAt,
  normalizePollDraft,
  pollDraftSchema,
  pollResponseSchema,
  pollScheduleSchema,
} from '../dist/polls/index.js';

test('treats an explicit closure as closed', () => {
  assert.equal(isPollClosedAt({ closedAt: null }, 999), false);
  assert.equal(isPollClosedAt({ closedAt: 1 }, 0), true);
});

test('validates publish, reminder, and close schedule ordering', () => {
  assert.equal(pollScheduleSchema.safeParse({
    publishAt: '2026-10-08T10:00:00.000Z',
    remindAt: '2026-10-08T10:30:00.000Z',
    closeAt: '2026-10-08T11:00:00.000Z',
  }).success, true);
  assert.equal(pollScheduleSchema.safeParse({
    publishAt: '2026-10-08T10:00:00.000Z',
    remindAt: '2026-10-08T11:00:00.000Z',
    closeAt: '2026-10-08T10:30:00.000Z',
  }).success, false);
});

const draft = (overrides = {}) => ({
  pollId: 'poll-1',
  allowAudienceChoices: false,
  isAnonymous: false,
  questions: [
    {
      id: 'question-1',
      question: '  Where should we meet?  ',
      options: [
        { id: 'option-1', text: '  Bengaluru  ' },
        { id: 'option-2', text: 'Chennai' },
      ],
    },
  ],
  ...overrides,
});

test('normalizes poll text while preserving stable client IDs and settings', () => {
  const normalized = normalizePollDraft(draft());

  assert.deepEqual(normalized, {
    pollId: 'poll-1',
    allowAudienceChoices: false,
    isAnonymous: false,
    resultVisibility: 'EVERYONE',
    sortResultsByVotes: false,
    questions: [
      {
        id: 'question-1',
        question: 'Where should we meet?',
        responseType: 'SINGLE_CHOICE',
        options: [
          { id: 'option-1', text: 'Bengaluru' },
          { id: 'option-2', text: 'Chennai' },
        ],
      },
    ],
  });
});

test('requires anonymity to be an explicit boolean', () => {
  assert.equal(pollDraftSchema.safeParse(draft({ isAnonymous: 'yes' })).success, false);
  assert.equal(pollDraftSchema.safeParse(draft({ isAnonymous: true })).success, true);
});

test('accepts result visibility and validates response shapes by question type', () => {
  const normalized = normalizePollDraft(draft({ resultVisibility: 'ADMIN_ONLY' }));

  assert.equal(normalized.resultVisibility, 'ADMIN_ONLY');
  assert.throws(
    () => pollResponseSchema.parse({ questionId: 'question-1', responseType: 'RATING_1_TO_5', rating: 6 }),
    /rating/i,
  );
});

test('allows non-choice questions without fake options', () => {
  for (const responseType of ['SHORT_TEXT', 'RATING_1_TO_5', 'Q_AND_A']) {
    const result = pollDraftSchema.safeParse(draft({
      questions: [{ id: `question-${responseType}`, question: 'Respond', responseType, options: [] }],
    }));
    assert.equal(result.success, true, `${responseType} should not require choice options`);
  }
});

test('rejects duplicate option labels regardless of case or surrounding whitespace', () => {
  const result = pollDraftSchema.safeParse(
    draft({
      questions: [
        {
          id: 'question-1',
          question: 'Pick one',
          options: [
            { id: 'option-1', text: 'Remote' },
            { id: 'option-2', text: '  REMOTE  ' },
          ],
        },
      ],
    }),
  );

  assert.equal(result.success, false);
  assert.match(result.error.issues[0].message, /duplicate/i);
});

test('rejects empty text, duplicate IDs, and values outside poll limits', () => {
  const invalidDrafts = [
    draft({ questions: [] }),
    draft({
      questions: [
        {
          id: 'question-1',
          question: '   ',
          options: [
            { id: 'option-1', text: 'A' },
            { id: 'option-2', text: 'B' },
          ],
        },
      ],
    }),
    draft({
      questions: [
        {
          id: 'question-1',
          question: 'Question',
          options: [{ id: 'option-1', text: 'Only one' }],
        },
      ],
    }),
    draft({
      questions: [
        {
          id: 'question-1',
          question: 'Question',
          options: [
            { id: 'option-1', text: 'A' },
            { id: 'option-1', text: 'B' },
          ],
        },
      ],
    }),
  ];

  for (const invalidDraft of invalidDrafts) {
    assert.equal(pollDraftSchema.safeParse(invalidDraft).success, false);
  }
});

test('enforces question and option length limits after trimming', () => {
  const longQuestion = draft();
  longQuestion.questions[0].question = 'q'.repeat(501);
  const longOption = draft();
  longOption.questions[0].options[0].text = 'o'.repeat(201);

  assert.equal(pollDraftSchema.safeParse(longQuestion).success, false);
  assert.equal(pollDraftSchema.safeParse(longOption).success, false);
});

test('builds searchable summaries for one and multiple questions', () => {
  const oneQuestion = normalizePollDraft(draft());
  const twoQuestions = normalizePollDraft(
    draft({
      questions: [
        draft().questions[0],
        {
          id: 'question-2',
          question: 'When?',
          options: [
            { id: 'option-3', text: 'Today' },
            { id: 'option-4', text: 'Tomorrow' },
          ],
        },
      ],
    }),
  );

  assert.equal(buildPollMessageSummary(oneQuestion), 'Poll: Where should we meet?');
  assert.equal(
    buildPollMessageSummary(twoQuestions),
    'Poll: Where should we meet? (+1 more)',
  );
});

test('keeps choice voting out of the generic response API and rejects duplicate rankings', () => {
  assert.throws(
    () =>
      pollResponseSchema.parse({
        questionId: 'q-1',
        responseType: 'MULTIPLE_CHOICE',
        optionIds: ['a', 'a'],
      }),
    /invalid|unrecognized/i,
  );
  assert.throws(
    () =>
      pollResponseSchema.parse({
        questionId: 'q-1',
        responseType: 'RANKING',
        rankedOptionIds: ['a', 'a'],
      }),
    /duplicate/i,
  );
});

test('escapes user-controlled poll summary text', () => {
  const poll = normalizePollDraft(
    draft({
      questions: [
        {
          id: 'q-1',
          question: '<img src=x onerror=alert(1)> & team',
          options: [
            { id: 'a', text: 'Yes' },
            { id: 'b', text: 'No' },
          ],
        },
      ],
    }),
  );

  assert.equal(
    buildPollMessageSummary(poll),
    'Poll: &lt;img src=x onerror=alert(1)&gt; &amp; team',
  );
});
