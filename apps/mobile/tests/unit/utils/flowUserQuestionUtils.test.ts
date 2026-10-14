import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createUserQuestionViewModel,
  findFirstIncompleteRequiredQuestionIndex,
  formatQuestionAnswerSummary,
  isUserQuestionFlow,
  parseQuestionOption,
  parseUserQuestionItems,
  sanitizeUserQuestionAnswers,
  SKIP_QUESTION_LABEL,
  userQuestionFlowToMarkdown,
} from '@/src/utils/flowUserQuestionUtils';
import type { FlowDefinitionLike } from '@/src/utils/flowJsonMarkdown';

const sampleFlow = (): FlowDefinitionLike => ({
  version: '2.0',
  screenId: 'user-question-9bdd9dac-c36d-4ba0-945d-f0444b010752',
  data: {
    actionType: 'user-answer',
    questionId: '9bdd9dac-c36d-4ba0-945d-f0444b010752',
    userId: 'user-1',
  },
  components: [
    {
      id: 'questions',
      type: 'user_question',
      props: {
        title: 'Questions',
        phase: 'pending',
        questions: [
          {
            id: 'pr-agent-scope',
            question: 'What kind of PR review agent do you want created?',
            type: 'single_choice',
            options: [
              {
                label: 'An automated agent that reviews pull requests on GitHub/Bitbucket',
                description: 'Triggers on PR events and posts review comments automatically',
              },
              'Skip this question',
            ],
          },
          {
            id: 'repo-target',
            question: 'Which repository should the agent target (if any)?',
            type: 'open_ended',
            placeholder: 'e.g., juspay/xyne-spaces',
            required: false,
          },
        ],
        submitAction: { type: 'submit', actionId: 'user-answer' },
      },
    },
  ],
  state: { values: {} },
});

describe('flowUserQuestionUtils', () => {
  it('detects user question flows', () => {
    assert.equal(isUserQuestionFlow(sampleFlow()), true);
  });

  it('filters skip option rows and parses option descriptions', () => {
    const questions = parseUserQuestionItems(
      sampleFlow().components?.[0]?.props as Record<string, unknown>,
    );
    assert.equal(questions.length, 2);
    assert.equal(questions[0]?.options.length, 1);
    assert.match(questions[0]?.options[0]?.description ?? '', /Triggers on PR events/);
    assert.deepEqual(parseQuestionOption('Skip this question'), { label: SKIP_QUESTION_LABEL });
  });

  it('builds a pending view model with submit action', () => {
    const viewModel = createUserQuestionViewModel(sampleFlow().components![0]!, sampleFlow(), {
      currentUserId: 'user-1',
    });
    assert.ok(viewModel);
    assert.equal(viewModel?.phase, 'pending');
    assert.equal(viewModel?.showActions, true);
    assert.deepEqual(viewModel?.submitAction, { type: 'submit', actionId: 'user-answer' });
  });

  it('exposes Submitted by footer fields after answer', () => {
    const flow = sampleFlow();
    const component = {
      ...flow.components![0]!,
      props: {
        ...(flow.components![0]!.props as Record<string, unknown>),
        phase: 'answered',
        answers: { 'pr-agent-scope': 'Manual agent' },
        decidedBy: 'Deepak Oram',
      },
    };
    const viewModel = createUserQuestionViewModel(component, flow, { currentUserId: 'user-1' });
    assert.ok(viewModel);
    assert.equal(viewModel?.phase, 'answered');
    assert.equal(viewModel?.submitterLabel, 'Submitted by');
    assert.equal(viewModel?.submitterUserId, 'user-1');
    assert.equal(viewModel?.submitterNameFallback, 'Deepak Oram');
    assert.equal(viewModel?.showActions, false);
  });

  it('validates required questions before submit', () => {
    const questions = parseUserQuestionItems(
      sampleFlow().components?.[0]?.props as Record<string, unknown>,
    );
    const incomplete = findFirstIncompleteRequiredQuestionIndex(questions, {}, {});
    assert.equal(incomplete, 0);
    assert.equal(
      findFirstIncompleteRequiredQuestionIndex(
        questions,
        { 'pr-agent-scope': 'An automated agent that reviews pull requests on GitHub/Bitbucket' },
        {},
      ),
      -1,
    );
    // Notes-only ("Something else") counts as complete.
    assert.equal(
      findFirstIncompleteRequiredQuestionIndex(
        questions,
        {},
        { 'pr-agent-scope': 'I want a hybrid agent' },
      ),
      -1,
    );
  });

  it('sanitizes blank answers so Something else notes survive backend validation', () => {
    assert.deepEqual(
      sanitizeUserQuestionAnswers({
        'pr-agent-scope': '',
        keep: 'Real option',
        multi: ['', 'Keep me', '  '],
        emptyMulti: [],
      }),
      {
        keep: 'Real option',
        multi: ['Keep me'],
      },
    );
  });

  it('formats terminal answer summaries', () => {
    const question = parseUserQuestionItems(
      sampleFlow().components?.[0]?.props as Record<string, unknown>,
    )[0]!;
    assert.equal(
      formatQuestionAnswerSummary(
        question,
        { 'pr-agent-scope': 'Manual agent' },
        { 'pr-agent-scope': 'Custom note' },
        'answered',
      ),
      'Manual agent, Custom note',
    );
    assert.equal(formatQuestionAnswerSummary(question, {}, {}, 'declined'), 'Dismissed');
  });

  it('projects pending cards to markdown', () => {
    const markdown = userQuestionFlowToMarkdown(sampleFlow());
    assert.match(markdown, /What kind of PR review agent do you want created\?/);
    assert.match(markdown, /Submit/);
  });
});
