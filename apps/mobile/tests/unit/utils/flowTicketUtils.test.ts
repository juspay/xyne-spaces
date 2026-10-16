import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isWriteApprovalFlow } from '@/src/utils/flowApprovalUtils';
import {
  flowDefinitionToMarkdown,
  type FlowComponentLike,
  type FlowDefinitionLike,
} from '@/src/utils/flowJsonMarkdown';
import {
  createTicketCardViewModel,
  formatTicketEta,
  isTicketFlow,
  ticketComponentToMarkdown,
  toTicketPreview,
  workspaceIdFromTicketUrl,
} from '@/src/utils/flowTicketUtils';

// Shapes mirror packages/xyne-claw-shared/src/flow/builder.ts
// buildTicketProposalFlow / buildTicketFlow.
const proposalComponent: FlowComponentLike = {
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
};

const proposalFlow: FlowDefinitionLike = {
  version: '2.0',
  screenId: 'ticket-proposal-1',
  components: [proposalComponent],
  data: { actionType: 'write', tool: 'spaces-create-ticket' },
};

const createdComponent: FlowComponentLike = {
  id: 'ticket',
  type: 'ticket',
  props: {
    phase: 'created',
    xyneId: 'XYNE-1',
    ticketId: 'tkt-1',
    title: 'Upgrade mobile @rocicorp/zero to 1.9.0',
    status: 'STARTED',
    priority: 'HIGH',
    stageName: 'In Progress',
    assigneeId: 'user-1',
    channelId: 'chan-1',
    conversationId: 'conv-1',
    url: '/ws-1/chat/dir/chan-1?tab=tickets&ticketId=tkt-1&conversationId=conv-1',
  },
};

const createdFlow: FlowDefinitionLike = {
  version: '2.0',
  screenId: 'ticket-XYNE-1',
  components: [createdComponent],
};

const withProps = (
  component: FlowComponentLike,
  overrides: Record<string, unknown>,
  omit: string[] = [],
): FlowComponentLike => {
  const props = { ...(component.props as Record<string, unknown>), ...overrides };
  for (const key of omit) delete props[key];
  return { ...component, props };
};

const actionIds = (component: FlowComponentLike): unknown[] =>
  createTicketCardViewModel(component)?.buttons.map(button =>
    button.action.type === 'submit' ? button.action.actionId : null,
  ) ?? [];

describe('flowTicketUtils', () => {
  describe('createTicketCardViewModel', () => {
    it('builds the proposal view model with approve/decline buttons', () => {
      const viewModel = createTicketCardViewModel(proposalComponent);
      assert.ok(viewModel);
      assert.equal(viewModel.phase, 'proposed');
      assert.equal(viewModel.idLabel, 'Draft');
      assert.equal(viewModel.statusLabel, 'Todo');
      assert.equal(viewModel.priorityLabel, 'Medium');
      assert.deepEqual(actionIds(proposalComponent), [
        'decline-write',
        'approve-write',
        'approve-continue',
      ]);
      assert.equal(viewModel.link, undefined);
    });

    it('gives every button a unique key so only the tapped one shows a spinner', () => {
      const keys = createTicketCardViewModel(proposalComponent)?.buttons.map(b => b.key) ?? [];
      assert.equal(new Set(keys).size, 3);
    });

    it('makes Approve primary when there is no approve-and-continue action', () => {
      const component = withProps(proposalComponent, {}, ['approveContinueAction']);
      const viewModel = createTicketCardViewModel(component);
      assert.ok(viewModel);
      assert.deepEqual(actionIds(component), ['decline-write', 'approve-write']);
      assert.equal(viewModel.buttons.find(b => b.label === 'Approve')?.variant, 'primary');
    });

    it('renders only the actions that are present', () => {
      assert.deepEqual(
        actionIds(withProps(proposalComponent, {}, ['approveContinueAction', 'declineAction'])),
        ['approve-write'],
      );
      assert.deepEqual(
        actionIds(withProps(proposalComponent, {}, ['approveAction', 'approveContinueAction'])),
        ['decline-write'],
      );
      assert.deepEqual(
        actionIds(
          withProps(proposalComponent, {}, [
            'approveAction',
            'approveContinueAction',
            'declineAction',
          ]),
        ),
        [],
      );
    });

    it('ignores malformed or non-submit actions', () => {
      const component = withProps(proposalComponent, {
        approveAction: { type: 'navigate', actionId: 'x' },
        approveContinueAction: { type: 'submit' },
        declineAction: 'decline-write',
      });
      assert.deepEqual(actionIds(component), []);
    });

    it('builds the created view model with an in-app ticket link and no buttons', () => {
      const viewModel = createTicketCardViewModel(createdComponent);
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

    it('keeps the link but omits the workspace when the created card has no url', () => {
      const viewModel = createTicketCardViewModel(withProps(createdComponent, {}, ['url']));
      assert.ok(viewModel);
      assert.deepEqual(viewModel.link, {
        ticketId: 'tkt-1',
        channelId: 'chan-1',
        conversationId: 'conv-1',
      });
    });

    it('has no link when the created card lacks ticket/channel/conversation ids', () => {
      for (const missing of ['ticketId', 'channelId', 'conversationId']) {
        const viewModel = createTicketCardViewModel(withProps(createdComponent, {}, [missing]));
        assert.ok(viewModel);
        assert.equal(viewModel.link, undefined, missing);
      }
    });

    it('treats a missing phase as a created card', () => {
      const viewModel = createTicketCardViewModel(withProps(createdComponent, {}, ['phase']));
      assert.equal(viewModel?.phase, 'created');
    });

    it('falls back to TODO / MEDIUM for unknown status and priority', () => {
      const viewModel = createTicketCardViewModel(
        withProps(createdComponent, { status: 'WEIRD', priority: 42 }),
      );
      assert.equal(viewModel?.status, 'TODO');
      assert.equal(viewModel?.priority, 'MEDIUM');
    });

    it('rejects non-ticket components and tickets without a title', () => {
      assert.equal(createTicketCardViewModel({ type: 'pr', props: { title: 'x' } }), null);
      assert.equal(createTicketCardViewModel({ type: 'ticket', props: { status: 'TODO' } }), null);
      assert.equal(createTicketCardViewModel({ type: 'ticket', props: { title: '   ' } }), null);
      assert.equal(createTicketCardViewModel({ type: 'ticket' }), null);
    });
  });

  describe('toTicketPreview', () => {
    it('maps a created card onto the chat TicketCard preview, preferring the stage', () => {
      const viewModel = createTicketCardViewModel(createdComponent);
      assert.ok(viewModel);
      assert.deepEqual(toTicketPreview(viewModel), {
        ticketId: 'XYNE-1',
        title: 'Upgrade mobile @rocicorp/zero to 1.9.0',
        description: null,
        statusLabel: 'In Progress',
        priority: 'HIGH',
        assigneeId: 'user-1',
      });
    });

    it('falls back to the status label and null assignee', () => {
      const viewModel = createTicketCardViewModel(
        withProps(createdComponent, {}, ['stageName', 'assigneeId']),
      );
      assert.ok(viewModel);
      const preview = toTicketPreview(viewModel);
      assert.equal(preview.statusLabel, 'Started');
      assert.equal(preview.assigneeId, null);
    });
  });

  describe('formatTicketEta', () => {
    it('returns undefined for empty or invalid input', () => {
      assert.equal(formatTicketEta(undefined), undefined);
      assert.equal(formatTicketEta(''), undefined);
      assert.equal(formatTicketEta('not-a-date'), undefined);
    });

    it('formats a valid date with the device locale', () => {
      const iso = '2026-10-20T10:00:00.000Z';
      assert.equal(
        formatTicketEta(iso),
        new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
      );
    });

    it('surfaces the formatted ETA on the view model only when valid', () => {
      assert.ok(
        createTicketCardViewModel(withProps(proposalComponent, { eta: '2026-10-20T10:00:00Z' }))
          ?.etaLabel,
      );
      assert.equal(
        createTicketCardViewModel(withProps(proposalComponent, { eta: 'bad' }))?.etaLabel,
        undefined,
      );
    });
  });

  describe('flow detection', () => {
    it('does not treat the ticket proposal as a generic write approval', () => {
      assert.equal(isTicketFlow(proposalFlow), true);
      assert.equal(isWriteApprovalFlow(proposalFlow), false);
      assert.equal(
        isWriteApprovalFlow({ ...proposalFlow, components: [{ type: 'card', children: [] }] }),
        true,
      );
    });

    it('isTicketFlow is false for flows without a ticket component', () => {
      assert.equal(isTicketFlow({ screenId: 'x', components: [{ type: 'text' }] }), false);
      assert.equal(isTicketFlow({ screenId: 'x' }), false);
    });
  });

  describe('markdown', () => {
    it('produces non-empty preview markdown for both phases', () => {
      assert.match(flowDefinitionToMarkdown(proposalFlow), /Ticket draft/);
      assert.match(flowDefinitionToMarkdown(createdFlow), /XYNE-1/);
    });

    it('returns an empty string for an invalid ticket', () => {
      assert.equal(ticketComponentToMarkdown({ type: 'ticket', props: {} }), '');
    });
  });

  describe('workspaceIdFromTicketUrl', () => {
    it('parses the workspace id from the claw ticket url', () => {
      assert.equal(workspaceIdFromTicketUrl('/ws-1/chat/dir/c?x=1'), 'ws-1');
      assert.equal(workspaceIdFromTicketUrl('https://x.y/ws-2/chat/dir/c'), 'ws-2');
      assert.equal(workspaceIdFromTicketUrl('/chat/dir/c'), undefined);
      assert.equal(workspaceIdFromTicketUrl('/ws-1/chat/other/c'), undefined);
      assert.equal(workspaceIdFromTicketUrl(undefined), undefined);
    });
  });
});
