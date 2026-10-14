import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createWriteApprovalViewModel,
  isWriteApprovalFlow,
  writeApprovalFlowToMarkdown,
} from '@/src/utils/flowApprovalUtils';
import type { FlowDefinitionLike } from '@/src/utils/flowJsonMarkdown';

const writeApprovalFlow = (): FlowDefinitionLike => ({
  version: '2.0',
  screenId: 'write-approval-1',
  title: 'Action Approval',
  components: [
    {
      id: 'intro',
      type: 'text',
      props: { content: 'The agent wants to execute:' },
    },
    {
      id: 'desc',
      type: 'card',
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
            action: { type: 'submit', actionId: 'approve-write' },
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
  },
  state: { values: {} },
});

const identity = (text: string): string => text;

describe('flowApprovalUtils', () => {
  it('detects write approval flows from metadata and screenId', () => {
    assert.equal(isWriteApprovalFlow(writeApprovalFlow()), true);
    assert.equal(
      isWriteApprovalFlow({
        screenId: 'write-approval-2',
        components: [],
      }),
      true,
    );
    assert.equal(
      isWriteApprovalFlow({
        screenId: 'agent-plan',
        data: { actionType: 'write' },
        components: [],
      }),
      true,
    );
    assert.equal(
      isWriteApprovalFlow({
        screenId: 'generic-form',
        components: [{ type: 'text', props: { content: 'Hello' } }],
      }),
      false,
    );
  });

  it('builds a write approval view model from the generic component tree', () => {
    const viewModel = createWriteApprovalViewModel(writeApprovalFlow(), identity);
    assert.ok(viewModel);
    assert.equal(viewModel.title, 'Action Approval');
    assert.equal(viewModel.intro, 'The agent wants to execute:');
    assert.equal(viewModel.actionName, 'update-agent');
    assert.equal(viewModel.tool, 'update-agent');
    assert.match(viewModel.actionBodyMarkdown, /xyne-spaces-architect/);
    assert.deepEqual(
      viewModel.buttons.map(button =>
        button.action.type === 'submit' ? button.action.actionId : button.action.type,
      ),
      ['approve-write', 'decline-write'],
    );
  });

  it('returns null when the action body card is missing', () => {
    assert.equal(
      createWriteApprovalViewModel(
        {
          screenId: 'write-approval-1',
          data: { actionType: 'write' },
          components: [{ type: 'text', props: { content: 'Intro only' } }],
        },
        identity,
      ),
      null,
    );
  });

  it('projects write approval flows to markdown for collapsed previews', () => {
    const markdown = writeApprovalFlowToMarkdown(writeApprovalFlow(), identity);
    assert.match(markdown, /# Action Approval/);
    assert.match(markdown, /The agent wants to execute:/);
    assert.match(markdown, /update-agent/);
    assert.match(markdown, /\*\*✓ {2}Approve\*\*/);
    assert.match(markdown, /Decline/);
  });

  it('can omit buttons from collapsed markdown previews', () => {
    const markdown = writeApprovalFlowToMarkdown(writeApprovalFlow(), identity, {
      omitButtons: true,
    });
    assert.doesNotMatch(markdown, /Approve/);
    assert.doesNotMatch(markdown, /Decline/);
  });
});
