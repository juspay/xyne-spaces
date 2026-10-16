import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyClientFlowAction,
  applyFlowActionResponse,
  flowActionErrorMessage,
  hasMissingRequiredFlowValues,
  implicitActionsForComponent,
  isFlowNetworkAction,
  listFlowActionButtons,
  parseFlowAction,
  resolveFlowActionTarget,
  toValidatedFlowDefinition,
  withImplicitFlowValues,
} from '@/src/utils/flowAction';
import type { FlowDefinitionLike } from '@/src/utils/flowJsonMarkdown';

const writeApprovalFlow = (): FlowDefinitionLike => ({
  version: '2.0',
  screenId: 'write-approval-1',
  title: 'Action Approval',
  components: [
    {
      id: 'intro',
      type: 'text',
      props: { content: 'The agent wants to execute:', variant: 'muted', size: 'sm' },
    },
    {
      id: 'desc',
      type: 'card',
      style: { maxHeight: '280px', overflowY: 'auto' },
      children: [
        {
          id: 'desc-body',
          type: 'text',
          props: { content: '*update-agent*\n\n*slug:* xyne-spaces-architect' },
        },
      ],
    },
    {
      id: 'actions',
      type: 'row',
      children: [
        {
          id: 'approve',
          type: 'button',
          props: {
            label: '✓  Approve',
            variant: 'primary',
            action: { type: 'submit', actionId: 'approve-write', successMessage: 'Approved' },
          },
        },
        {
          id: 'approve-continue',
          type: 'button',
          props: {
            label: '✓  Approve & Continue',
            variant: 'secondary',
            action: {
              type: 'submit',
              actionId: 'approve-continue',
              successMessage: 'Approved — continuing',
            },
          },
        },
        {
          id: 'decline',
          type: 'button',
          props: {
            label: '✕  Decline',
            variant: 'destructive',
            action: { type: 'submit', actionId: 'decline-write' },
          },
        },
      ],
    },
  ],
  data: {
    actionType: 'write',
    tool: 'update-agent',
    params: '{}',
  },
  state: { values: {} },
});

describe('flowAction helpers', () => {
  it('lists nested submit buttons in document order', () => {
    const buttons = listFlowActionButtons(writeApprovalFlow());
    assert.deepEqual(
      buttons.map(button => [
        button.key,
        button.label,
        button.variant,
        button.action.type === 'submit' ? button.action.actionId : button.action.type,
      ]),
      [
        ['flow-actions-approve', '✓  Approve', 'primary', 'approve-write'],
        ['flow-actions-approve-continue', '✓  Approve & Continue', 'secondary', 'approve-continue'],
        ['flow-actions-decline', '✕  Decline', 'destructive', 'decline-write'],
      ],
    );
  });

  it('skips label-only buttons when listing live actions', () => {
    assert.deepEqual(
      listFlowActionButtons({
        screenId: 'ack',
        components: [{ type: 'button', props: { label: 'Acknowledge' } }],
      }),
      [],
    );
  });

  it('lists client-only and implicit dashboard buttons', () => {
    const buttons = listFlowActionButtons({
      screenId: 'mixed',
      components: [
        {
          id: 'done',
          type: 'button',
          props: { label: 'Done', action: { type: 'close_screen', finalMessage: 'Closed' } },
        },
        {
          id: 'plan',
          type: 'plan',
          props: {
            phase: 'proposed',
            title: 'Plan',
            todos: [{ id: 't1', text: 'One', included: true }],
          },
        },
      ],
    });
    assert.deepEqual(
      buttons.map(button => [
        button.label,
        button.action.type === 'submit' ? button.action.actionId : button.action.type,
      ]),
      [
        ['Done', 'close_screen'],
        ['Approve', 'plan-approve'],
        ['Reject', 'plan-reject'],
      ],
    );
  });

  it('parses submit actions from Flow button props', () => {
    const action = parseFlowAction({
      label: '✓  Approve',
      action: { type: 'submit', actionId: 'approve-write', successMessage: 'Approved' },
    });

    assert.deepEqual(action, {
      type: 'submit',
      actionId: 'approve-write',
      successMessage: 'Approved',
    });
    assert.equal(isFlowNetworkAction(action), true);
  });

  it('does not treat a label-only button as a live action', () => {
    assert.equal(parseFlowAction({ label: 'Acknowledge' }), null);
    assert.equal(isFlowNetworkAction(null), false);
  });

  it('validates a write-approval card the same way dashboard does', () => {
    const flow = toValidatedFlowDefinition(writeApprovalFlow());
    assert.ok(flow);
    assert.equal(flow?.screenId, 'write-approval-1');
    assert.equal(flow?.state.submitting, false);
    assert.equal(hasMissingRequiredFlowValues(flow?.components, {}), false);
  });

  it('allows agent-card submit when shared schema lags behind the artifact type', () => {
    const flow = toValidatedFlowDefinition({
      version: '2.0',
      screenId: 'agent-card-1',
      components: [
        {
          id: 'agent',
          type: 'agent',
          props: {
            variant: 'draft',
            phase: 'pending',
            agent: { name: 'Ticket triage', slug: 'ticket-triage' },
            selected: ['github'],
          },
        },
      ],
      data: {
        actionType: 'agent-card',
        requestId: 'req-1',
        userId: 'user-1',
      },
      state: { values: { agent: ['github'] } },
    });

    assert.ok(flow);
    assert.equal(flow?.screenId, 'agent-card-1');
    assert.deepEqual(flow?.state.values['agent'], ['github']);
    assert.equal(flow?.data?.['actionType'], 'agent-card');
  });

  it('allows user_question submit when shared schema lags behind the artifact type', () => {
    const flow = toValidatedFlowDefinition({
      version: '2.0',
      screenId: 'user-question-1',
      components: [
        {
          id: 'questions',
          type: 'user_question',
          props: {
            title: 'Quick questions',
            phase: 'pending',
            questions: [
              {
                id: 'q1',
                question: 'Pick one',
                type: 'single_choice',
                options: ['A', 'B'],
              },
            ],
            submitAction: { type: 'submit', actionId: 'user-answer' },
          },
        },
      ],
      state: {
        values: {
          answers: { q1: 'A' },
          notes: {},
        },
      },
    });
    assert.ok(flow);
    assert.equal(flow?.screenId, 'user-question-1');
    assert.deepEqual(flow?.state.values['answers'], { q1: 'A' });
  });

  it('rejects a submit when a required field is empty', () => {
    assert.equal(
      hasMissingRequiredFlowValues(
        [{ type: 'input', props: { name: 'answer', required: true } }],
        {},
      ),
      true,
    );
  });

  it('enables actions only on the original message with both ids', () => {
    assert.deepEqual(
      resolveFlowActionTarget({
        messageId: 'msg-1',
        conversationId: 'conv-1',
        isForwarded: false,
      }),
      { messageId: 'msg-1', conversationId: 'conv-1', canExecute: true },
    );
    assert.equal(
      resolveFlowActionTarget({
        messageId: 'msg-1',
        conversationId: 'conv-1',
        isForwarded: true,
      }).canExecute,
      false,
    );
    assert.equal(
      resolveFlowActionTarget({
        messageId: '',
        fallbackConversationId: 'conv-1',
        isForwarded: false,
      }).canExecute,
      false,
    );
    assert.deepEqual(
      resolveFlowActionTarget({
        fallbackMessageId: 'msg-1',
        conversationId: 'conv-1',
        isForwarded: false,
      }),
      { messageId: 'msg-1', conversationId: 'conv-1', canExecute: true },
    );
    assert.equal(
      resolveFlowActionTarget({
        messageId: 'msg-1',
        fallbackConversationId: 'msg-1',
        isForwarded: false,
      }).canExecute,
      false,
    );
  });

  it('replaces the screen on next_screen and keeps it on close_screen', () => {
    const current = writeApprovalFlow();
    const nextScreen = applyFlowActionResponse(current, {
      type: 'next_screen',
      flowJSON: {
        version: '2.0',
        screenId: 'write-result-1',
        components: [{ id: 'ok', type: 'text', props: { content: 'Approved' } }],
        state: {
          values: {},
          touched: {},
          errors: {},
          submitting: false,
          submitted: false,
          history: [],
          loadingComponentIds: [],
        },
      },
    });
    assert.equal(nextScreen.flow.screenId, 'write-result-1');

    const closed = applyFlowActionResponse(current, {
      type: 'close_screen',
      finalMessage: 'Approved',
    });
    assert.equal(closed.flow, current);
    assert.equal(closed.errorMessage, undefined);
  });

  it('surfaces error responses without swapping the card', () => {
    const current = writeApprovalFlow();
    const next = applyFlowActionResponse(current, {
      type: 'error',
      message: 'Unauthorized',
    });
    assert.equal(next.flow, current);
    assert.equal(next.errorMessage, 'Unauthorized');
  });

  it('reads the dashboard error body from an HTTP failure', () => {
    const error = { responseBody: JSON.stringify({ type: 'error', message: 'Unauthorized' }) };
    assert.equal(flowActionErrorMessage(error), 'Unauthorized');
  });

  it('unwraps Spaces proxy details so Create Agent shows the claw-auth message', () => {
    const error = {
      responseBody: JSON.stringify({
        error: 'App backend error 403',
        details: [
          JSON.stringify({ type: 'error', message: 'Only the requester can create this agent' }),
        ],
      }),
    };
    assert.equal(flowActionErrorMessage(error), 'Only the requester can create this agent');
  });

  it('prefers the user-facing message when error is a code', () => {
    const error = {
      responseBody: JSON.stringify({ error: 'Forbidden', message: 'You cannot create this agent' }),
    };
    assert.equal(flowActionErrorMessage(error), 'You cannot create this agent');
  });

  it('reads nested error.message the same way dashboard axios does', () => {
    const error = {
      responseBody: JSON.stringify({ error: { message: 'Slug is already taken' } }),
    };
    assert.equal(flowActionErrorMessage(error), 'Slug is already taken');
  });

  it('applies client-only update_state the same way dashboard does', () => {
    const current = writeApprovalFlow();
    const next = applyClientFlowAction(current, {
      type: 'update_state',
      stateUpdates: { answer: 'yes' },
      successMessage: 'Saved',
    });
    assert.equal(next.flow.state?.values?.['answer'], 'yes');
    assert.equal(next.toastMessage, 'Saved');
  });

  it('seeds proposed plan todos so Approve can POST like dashboard', () => {
    const values = withImplicitFlowValues({
      screenId: 'agent-plan',
      components: [
        {
          id: 'plan',
          type: 'plan',
          props: {
            phase: 'proposed',
            todos: [
              { id: 'a', text: 'One', included: true },
              { id: 'b', text: 'Two', included: false },
            ],
          },
        },
      ],
      state: { values: {} },
    });
    assert.deepEqual(values['plan'], ['a']);
  });

  it('seeds draft agent capability selection for approve payload', () => {
    const values = withImplicitFlowValues({
      screenId: 'agent-card-test',
      components: [
        {
          id: 'agent',
          type: 'agent',
          props: {
            variant: 'draft',
            phase: 'pending',
            selected: ['github', 'web-search'],
            agent: {
              name: 'PR Review Agent',
              slug: 'pr-review-agent',
              capabilities: [{ id: 'github' }, { id: 'web-search' }],
            },
          },
        },
      ],
      state: { values: {} },
    });
    assert.deepEqual(values['agent'], ['github', 'web-search']);
  });

  it('seeds empty user question answer maps', () => {
    const values = withImplicitFlowValues({
      screenId: 'user-question-test',
      components: [
        {
          id: 'questions',
          type: 'user_question',
          props: {
            phase: 'pending',
            questions: [
              { id: 'q1', question: 'Pick one', type: 'single_choice', options: ['A', 'B'] },
            ],
            submitAction: { type: 'submit', actionId: 'user-answer' },
          },
        },
      ],
      state: { values: {} },
    });
    assert.deepEqual(values['answers'], {});
    assert.deepEqual(values['notes'], {});
  });

  it('exposes draft agent approve and decline actions', () => {
    const buttons = implicitActionsForComponent(
      {
        id: 'agent',
        type: 'agent',
        props: { variant: 'draft', phase: 'pending' },
      },
      'flow-agent',
    );
    assert.deepEqual(
      buttons.map(button => button.action),
      [
        { type: 'submit', actionId: 'agent-draft-decline' },
        { type: 'submit', actionId: 'agent-draft-approve' },
      ],
    );
  });
});
