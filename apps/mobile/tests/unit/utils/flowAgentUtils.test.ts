import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  agentCardFlowToMarkdown,
  agentChatPath,
  agentLibraryPath,
  canUserActOnAgentCard,
  createAgentCardViewModel,
  getAgentSummaryEntries,
  getDefaultAgentCapabilitySelection,
  isAgentCardFlow,
  resolveAgentStatus,
  shouldCloseAgentPreviewAfterAction,
  shouldCloseAgentPreviewForPhase,
  toolItemsForGroup,
} from '@/src/utils/flowAgentUtils';
import type { FlowDefinitionLike } from '@/src/utils/flowJsonMarkdown';

const identity = (text: string): string => text;

const draftAgentFlow = (): FlowDefinitionLike => ({
  version: '2.0',
  screenId: 'agent-card-test',
  data: {
    actionType: 'agent-card',
    userId: 'user-1',
  },
  components: [
    {
      id: 'agent',
      type: 'agent',
      props: {
        variant: 'draft',
        phase: 'pending',
        agent: {
          name: 'PR Review Agent',
          slug: 'pr-review-agent',
          description: 'Reviews pull requests.',
          capabilities: [
            { id: 'github', label: 'GitHub', kind: 'subagent' },
            { id: 'web-search', label: 'Web Search', kind: 'tool' },
          ],
        },
        selected: ['github'],
      },
    },
  ],
  state: { values: {} },
});

describe('flowAgentUtils', () => {
  it('detects agent card flows', () => {
    assert.equal(isAgentCardFlow(draftAgentFlow()), true);
    assert.equal(
      isAgentCardFlow({
        screenId: 'agent-card-abc',
        components: [],
      }),
      true,
    );
    assert.equal(
      isAgentCardFlow({
        screenId: 'generic',
        components: [{ type: 'text', props: { content: 'hello' } }],
      }),
      false,
    );
  });

  it('maps draft phases to status chips', () => {
    assert.deepEqual(resolveAgentStatus('draft', 'pending'), {
      statusLabel: 'Draft',
      statusTone: 'pending',
    });
    assert.deepEqual(resolveAgentStatus('draft', 'created'), {
      statusLabel: 'Created',
      statusTone: 'completed',
    });
    assert.deepEqual(resolveAgentStatus('profile', undefined), {
      statusLabel: 'Created',
      statusTone: 'completed',
    });
  });

  it('builds a compact pending draft view model', () => {
    const viewModel = createAgentCardViewModel(
      draftAgentFlow().components![0]!,
      draftAgentFlow(),
      identity,
      { currentUserId: 'user-1' },
    );

    assert.ok(viewModel);
    assert.equal(viewModel?.name, 'PR Review Agent');
    assert.equal(viewModel?.slug, 'pr-review-agent');
    assert.equal(viewModel?.statusLabel, 'Draft');
    assert.equal(viewModel?.showActions, true);
    assert.equal(viewModel?.showExpandAction, true);
    assert.equal(viewModel?.showViewAction, false);
    assert.equal(viewModel?.showChatAction, false);
    assert.equal(viewModel?.modelLabel, 'Platform default');
    assert.equal(viewModel?.providerLabel, 'Spaces default');
    assert.equal(viewModel?.knowledgeAppliesTo, 'The collections below');
    assert.equal(viewModel?.memoryEnabled, false);
    assert.deepEqual(viewModel?.skills, []);
    assert.equal(viewModel?.canEditDraft, false);
  });

  it('maps preview model, providers, tools, and knowledge from the agent payload', () => {
    const viewModel = createAgentCardViewModel(
      {
        id: 'agent',
        type: 'agent',
        props: {
          variant: 'draft',
          phase: 'pending',
          note: 'Not granted — built-in web search.',
          agent: {
            name: 'AI Eventscout',
            slug: 'ai-eventscout',
            description: 'Weekly scan of global AI conferences.',
            systemPrompt: 'You are AI Eventscout.',
            modelId: '',
            providerOrder: [],
            capabilities: [
              { id: 'web-search', label: 'Web Search', kind: 'tool', group: 'builtin' },
              {
                id: 'gh-prs',
                label: 'list_prs',
                kind: 'tool',
                group: 'mcp',
                parentId: 'github',
                parentLabel: 'GitHub',
              },
              {
                id: 'gh-issues',
                label: 'list_issues',
                kind: 'tool',
                group: 'mcp',
                parentId: 'github',
                parentLabel: 'GitHub',
              },
            ],
            skills: [{ id: 'scan', name: 'Scan events', description: 'Weekly scan' }],
            knowledge: {
              scope: 'USER',
              sources: [{ id: 'col-1', name: 'Events', kind: 'collection' }],
            },
            memory: { enabled: true, requiresApproval: true },
          },
          toolSelection: {
            subagents: [],
            direct: ['gh-prs'],
            custom: [],
            gateway: [],
            callableAgents: [],
          },
        },
      },
      draftAgentFlow(),
      identity,
    );

    assert.equal(viewModel?.canEditDraft, true);
    assert.equal(viewModel?.modelLabel, 'Platform default');
    assert.equal(viewModel?.providerLabel, 'Spaces default');
    assert.equal(viewModel?.systemPrompt, 'You are AI Eventscout.');
    assert.equal(viewModel?.footnote, 'Not granted — built-in web search.');
    assert.equal(viewModel?.knowledgeAppliesTo, "Each user's own access");
    assert.equal(viewModel?.memoryEnabled, true);
    assert.equal(viewModel?.memoryRequiresApproval, true);
    assert.deepEqual(viewModel?.skills, [
      { id: 'scan', name: 'Scan events', description: 'Weekly scan' },
    ]);
    assert.deepEqual(viewModel?.knowledgeSources, [
      { id: 'col-1', name: 'Events', description: 'Collection' },
    ]);
    assert.deepEqual(toolItemsForGroup(viewModel?.capabilities ?? [], 'mcp'), [
      {
        id: 'github',
        name: 'GitHub',
        description: 'list prs, list issues',
        ids: ['gh-prs', 'gh-issues'],
      },
    ]);
    assert.equal(
      toolItemsForGroup(viewModel?.capabilities ?? [], 'builtin')[0]?.name,
      'Web Search',
    );
  });

  it('does not let anyone decide when data.userId is missing', () => {
    assert.equal(
      canUserActOnAgentCard(
        {
          screenId: 'agent-card-test',
          data: { actionType: 'agent-card' },
          components: [],
        },
        'user-1',
      ),
      false,
    );
  });

  it('shows View and Chat on created drafts and profiles', () => {
    const created = createAgentCardViewModel(
      {
        id: 'agent',
        type: 'agent',
        props: {
          variant: 'draft',
          phase: 'created',
          decidedBy: 'Ada',
          decidedById: 'user-1',
          agent: { name: 'PR Review Agent', slug: 'pr-review-agent', description: 'Reviews PRs.' },
        },
      },
      draftAgentFlow(),
      identity,
      { currentUserId: 'user-1' },
    );
    assert.equal(created?.showActions, false);
    assert.equal(created?.showExpandAction, false);
    assert.equal(created?.showViewAction, true);
    assert.equal(created?.showChatAction, true);
    assert.equal(created?.decidedByLabel, 'Created by');

    const profile = createAgentCardViewModel(
      {
        id: 'agent',
        type: 'agent',
        props: {
          variant: 'profile',
          agent: { name: 'PR Review Agent', slug: 'pr-review-agent', description: 'Reviews PRs.' },
        },
      },
      { ...draftAgentFlow(), data: { actionType: 'agent-card', variant: 'profile' } },
      identity,
    );
    assert.equal(profile?.showActions, false);
    assert.equal(profile?.showViewAction, true);
    assert.equal(profile?.showChatAction, true);
  });

  it('does not treat roster variants as draft cards', () => {
    assert.equal(
      createAgentCardViewModel(
        {
          id: 'agent',
          type: 'agent',
          props: {
            variant: 'summary',
            agent: { name: 'PR Review Agent', slug: 'pr-review-agent' },
          },
        },
        draftAgentFlow(),
        identity,
        { currentUserId: 'user-1' },
      ),
      null,
    );
  });

  it('still paints Decline / Create for non-owners (dashboard parity; server authz)', () => {
    const viewModel = createAgentCardViewModel(
      draftAgentFlow().components![0]!,
      draftAgentFlow(),
      identity,
      { currentUserId: 'other-user' },
    );

    assert.equal(viewModel?.showActions, true);
    assert.equal(canUserActOnAgentCard(draftAgentFlow(), 'other-user'), false);
  });

  it('shows expand on pending drafts and View on created ones', () => {
    const pending = createAgentCardViewModel(
      draftAgentFlow().components![0]!,
      draftAgentFlow(),
      identity,
    );
    assert.equal(pending?.showExpandAction, true);
    assert.equal(pending?.showViewAction, false);
  });

  it('seeds capability selection from props.selected', () => {
    const props = draftAgentFlow().components?.[0]?.props as Record<string, unknown>;
    assert.deepEqual(getDefaultAgentCapabilitySelection(props), ['github']);
  });

  it('keeps the agent preview open while the draft is still pending', () => {
    // Regression: closing on isSubmitting raced the failure handler. Phase is
    // the only signal that should collapse the sheet from the card.
    assert.equal(shouldCloseAgentPreviewForPhase('pending'), false);
    assert.equal(shouldCloseAgentPreviewForPhase(undefined), true);
    assert.equal(shouldCloseAgentPreviewForPhase('created'), true);
    assert.equal(shouldCloseAgentPreviewForPhase('rejected'), true);
  });

  it('keeps the agent preview open when approve/decline reports failure', () => {
    assert.equal(shouldCloseAgentPreviewAfterAction(false), false);
    assert.equal(shouldCloseAgentPreviewAfterAction(true), true);
    assert.equal(shouldCloseAgentPreviewAfterAction(undefined), true);
  });

  it('builds dashboard library and chat paths', () => {
    assert.equal(agentLibraryPath('ticket-triage'), '/ai/library/agent/ticket-triage?tab=persona');
    assert.equal(agentChatPath('ticket-triage'), '/ai/chat/new?agent=ticket-triage');
  });

  it('reads roster entries without inventing submit actions', () => {
    assert.deepEqual(
      getAgentSummaryEntries({
        agents: [{ name: 'Triage', slug: 'ticket-triage' }, { name: 'skip' }],
      }),
      [{ name: 'Triage', slug: 'ticket-triage' }],
    );
  });

  it('projects agent cards to markdown', () => {
    const markdown = agentCardFlowToMarkdown(draftAgentFlow(), identity);
    assert.match(markdown, /PR Review Agent/);
    assert.match(markdown, /@pr-review-agent/);
    assert.match(markdown, /Create Agent/);
  });
});
