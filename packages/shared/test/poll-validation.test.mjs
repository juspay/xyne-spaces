import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPollMessageSummary,
  normalizePollDraft,
  pollDraftSchema,
} from '../dist/polls/index.js';

const draft = (overrides = {}) => ({
  pollId: 'poll-1',
  allowComments: true,
  allowMultipleVotes: false,
  allowAudienceChoices: false,
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
    allowComments: true,
    allowMultipleVotes: false,
    allowAudienceChoices: false,
    questions: [
      {
        id: 'question-1',
        question: 'Where should we meet?',
        options: [
          { id: 'option-1', text: 'Bengaluru' },
          { id: 'option-2', text: 'Chennai' },
        ],
      },
    ],
  });
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
