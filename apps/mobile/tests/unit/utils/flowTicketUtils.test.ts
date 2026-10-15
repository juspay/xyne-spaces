import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isWriteApprovalFlow } from '@/src/utils/flowApprovalUtils';
import { flowDefinitionToMarkdown, type FlowDefinitionLike } from '@/src/utils/flowJsonMarkdown';
import {
  createTicketCardViewModel,
  isTicketFlow,
  workspaceIdFromTicketUrl,
} from '@/src/utils/flowTicketUtils';

// Shapes mirror packages/xyne-claw-shared/src/flow/builder.ts
// buildTicketProposalFlow / buildTicketFlow.
const proposalFlow: FlowDefinitionLike = {
  version: '2.0',
  screenId: 'ticket-proposal-1',
  components: [
    {
      id: 'ticket',
      type: 'ticket',
      props: {
        phase: 'proposed',
        title: 'Upgrade mobile @rocicorp/zero to 1.9.0',
        status: 'TODO',
        priority: 'MEDIUM',
        assigneeId: 'user-1',
        approveAction: { type: 'submit', actionId: 'approve-write', successMessage: 'Approved' },
        approveContinueAction: { type: 'submit', actionId: 'approve-continue' },
        declineAction: { type: 'submit', actionId: 'decline-write' },
      },
    },
  ],
  data: { actionType: 'write', tool: 'spaces-create-ticket' },
};

const createdFlow: FlowDefinitionLike = {
  version: '2.0',
  screenId: 'ticket-XYNE-1',
  components: [
    {
      id: 'ticket',
      type: 'ticket',
      props: {
        phase: 'created',
        xyneId: 'XYNE-1',
        ticketId: 'tkt-1',
        title: 'Upgrade mobile @rocicorp/zero to 1.9.0',
        status: 'STARTED',
        priority: 'HIGH',
        channelId: 'chan-1',
        conversationId: 'conv-1',
        url: '/ws-1/chat/dir/chan-1?tab=tickets&ticketId=tkt-1&conversationId=conv-1',
      },
    },
  ],
};

describe('flowTicketUtils', () => {
  it('builds the proposal view model with approve/decline buttons', () => {
    const viewModel = createTicketCardViewModel(proposalFlow.components![0]!);
    assert.ok(viewModel);
    assert.equal(viewModel.phase, 'proposed');
    assert.equal(viewModel.idLabel, 'Draft');
    assert.equal(viewModel.statusLabel, 'Todo');
    assert.equal(viewModel.priorityLabel, 'Medium');
    assert.deepEqual(
      viewModel.buttons.map(button => button.action.type === 'submit' && button.action.actionId),
      ['decline-write', 'approve-write', 'approve-continue'],
    );
    assert.equal(viewModel.link, undefined);
  });

  it('builds the created view model with an in-app ticket link and no buttons', () => {
    const viewModel = createTicketCardViewModel(createdFlow.components![0]!);
    assert.ok(viewModel);
    assert.equal(viewModel.phase, 'created');
    assert.equal(viewModel.idLabel, 'XYNE-1');
    assert.equal(viewModel.buttons.length, 0);
    assert.deepEqual(viewModel.link, {
      ticketId: 'tkt-1',
      channelId: 'chan-1',
      conversationId: 'conv-1',
      workspaceId: 'ws-1',
    });
  });

  it('rejects a ticket without a title', () => {
    assert.equal(createTicketCardViewModel({ type: 'ticket', props: { status: 'TODO' } }), null);
  });

  it('does not treat the ticket proposal as a generic write approval', () => {
    assert.equal(isTicketFlow(proposalFlow), true);
    assert.equal(isWriteApprovalFlow(proposalFlow), false);
    assert.equal(
      isWriteApprovalFlow({ ...proposalFlow, components: [{ type: 'card', children: [] }] }),
      true,
    );
  });

  it('produces non-empty preview markdown for both phases', () => {
    assert.match(flowDefinitionToMarkdown(proposalFlow), /Ticket draft/);
    assert.match(flowDefinitionToMarkdown(createdFlow), /XYNE-1/);
  });

  it('parses the workspace id from the claw ticket url', () => {
    assert.equal(workspaceIdFromTicketUrl('/ws-1/chat/dir/c?x=1'), 'ws-1');
    assert.equal(workspaceIdFromTicketUrl('https://x.y/ws-2/chat/dir/c'), 'ws-2');
    assert.equal(workspaceIdFromTicketUrl('/chat/dir/c'), undefined);
    assert.equal(workspaceIdFromTicketUrl(undefined), undefined);
  });
});
