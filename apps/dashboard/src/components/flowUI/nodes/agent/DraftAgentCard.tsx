import React, { useContext, useEffect, useState } from 'react';
import { MaximizeFourArrow, Spinner } from '@xyne/icons';
import type { AgentDraftProps, FlowComponent } from '@xyne/shared';
import { useFlow } from '../../FlowContext';
import { useAgentProgress } from '../../../../hooks/useAgentProgress';
import { cn } from '../../../../utils/classNames';
import { AuditLine, CardShell, Mention, StatusChip, formatDecisionTime } from '../cardPrimitives';
import Avatar from '../../../ui/Avatar/Avatar';
import { AgentIdentityBlock, AgentConnectPrompt } from './AgentIdentityBlock';
import { AgentPreview, InsideAgentPreviewContext } from './AgentPreview';

/**
 * The `agent` artifact's DRAFT variant — an agent an agent proposed, awaiting
 * the requester's decision.
 *
 *   pending  → capability chips are toggles; Approve / Decline in the footer.
 *   created  → Created chip, identity read-only, audit footer.
 *   rejected → Rejected chip, identity read-only, audit footer.
 *
 * All three render the SAME identity block; the backend updates this card in
 * place (same screenId + component id) rather than posting a new message, so
 * the thread keeps one card per draft.
 *
 * Selection lives in flow-state under this component's id, which is what the
 * server reads on submit. It can only NARROW the grant — the backend intersects
 * whatever arrives with the capabilities it resolved itself.
 */
export const DraftAgentCard: React.FC<{ node: FlowComponent; props: AgentDraftProps }> = ({
  node,
  props,
}) => {
  const { state, updateFieldValue, executeAction, conversationId, messageId } = useFlow();
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null);
  const [expanded, setExpanded] = useState(false);
  // A copy of this card lives inside its own AgentPreview thread panel; hide the
  // expand control there so it can't open a nested preview.
  const insidePreview = useContext(InsideAgentPreviewContext);

  const capabilities = props.agent.capabilities ?? [];
  const decided = props.phase !== 'pending';

  // Seed once from props, then flow-state owns it (the plan card's pattern) —
  // props stay the server's view, state stays the user's edits.
  const stored = state.values[node.id];
  const seeded = Array.isArray(stored);
  const selected = new Set<string>(
    seeded ? (stored as string[]) : (props.selected ?? capabilities.map(c => c.id)),
  );

  useEffect(() => {
    if (state.values[node.id] === undefined) {
      updateFieldValue(node.id, props.selected ?? capabilities.map(c => c.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  // Approving mid-run dispatches work that collides with the active run at the
  // runtime session lock. The server also fails this closed; disabling the
  // button is just the clearer signal.
  const { agents } = useAgentProgress(conversationId || undefined);
  const agentRunning = agents.length > 0;
  const locked = state.submitting || decided || pending !== null;

  const toggle = (id: string): void => {
    if (locked) {
      return;
    }
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    updateFieldValue(node.id, Array.from(next));
  };

  const submit = async (actionId: 'agent-draft-approve' | 'agent-draft-decline'): Promise<void> => {
    if (locked || (actionId === 'agent-draft-approve' && agentRunning)) {
      return;
    }
    setPending(actionId === 'agent-draft-approve' ? 'approve' : 'reject');
    try {
      await executeAction({ type: 'submit', actionId });
      // On a decision, drop the expanded view back to the thread.
      setExpanded(false);
    } finally {
      setPending(null);
    }
  };

  // The artifact's state rides beside the agent's name (the design's "Beta"
  // pill position), which is what lets the card drop its header bar entirely.
  // The chip itself is the plan card's StatusChip, tone for tone, so the two
  // artifacts label their state identically.
  const statePill =
    props.phase === 'created' ? (
      <StatusChip label='Created' />
    ) : props.phase === 'rejected' ? (
      <StatusChip label='Declined' tone='rejected' />
    ) : (
      <StatusChip label='Draft' tone='muted' />
    );

  // Built as nodes, not a string, so the actor renders as a mention.
  const decidedAtLabel = formatDecisionTime(props.decidedAt);
  const auditNode = (
    <div className='flex min-w-0 items-center gap-1.5'>
      {/* Same avatar treatment as the reply tray — the decider is a person, so
          they read as one rather than as a name in prose. */}
      {props.decidedById && (
        <Avatar userId={props.decidedById} size='xs' rounded showActiveStatus={false} />
      )}
      <AuditLine>
        {props.phase === 'created' ? 'Created' : 'Declined'}
        {props.decidedBy && (
          <>
            {' by '}
            <Mention handle={props.decidedBy} />
          </>
        )}
        {decidedAtLabel && ` · ${decidedAtLabel}`}
      </AuditLine>
    </div>
  );

  const approveLabel =
    pending === 'approve' ? 'Creating…' : agentRunning ? 'Agent is working…' : 'Create agent';

  const interactive = decided ? undefined : { selected, onToggle: toggle, disabled: locked };

  // Approve / Decline controls, shared by the compact card footer AND the
  // expanded preview footer (submit() closes the preview on a decision).
  const actionControls = (
    <div className='flex shrink-0 items-center gap-2'>
      {agentRunning && (
        <span className='hidden text-xs text-muted-foreground sm:inline'>
          Approve once it finishes.
        </span>
      )}
      <button
        type='button'
        onClick={() => void submit('agent-draft-decline')}
        disabled={locked}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border border-transparent px-2 py-1.5',
          'text-sm font-medium leading-[1.2] text-muted-foreground',
          'hover:bg-foreground/[0.04] hover:text-foreground',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
        data-track-category='AGENT_ARTIFACT'
        data-track-name='CLICK_DECLINE'
      >
        {pending === 'reject' && <Spinner size={14} className='animate-spin' />}
        {pending === 'reject' ? 'Declining…' : 'Decline'}
      </button>
      <button
        type='button'
        onClick={() => void submit('agent-draft-approve')}
        disabled={locked || agentRunning}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5',
          'text-sm font-medium leading-[1.2] text-foreground',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
        data-track-category='AGENT_ARTIFACT'
        data-track-name='CLICK_APPROVE'
      >
        {(pending === 'approve' || agentRunning) && <Spinner size={14} className='animate-spin' />}
        {approveLabel}
      </button>
    </div>
  );

  return (
    <CardShell style={node.style}>
      <div className={cn('flex flex-col p-4', props.phase === 'rejected' && 'opacity-60')}>
        {/* No header bar: the state pill sits beside the name and the expand
            control rides in the same row, so nothing exists purely as chrome. */}
        <AgentIdentityBlock
          agent={props.agent}
          {...(interactive ? { interactive } : {})}
          note={props.note}
          statePill={statePill}
          trailing={
            insidePreview ? undefined : (
              <button
                type='button'
                onClick={(): void => setExpanded(true)}
                aria-label='Expand agent'
                className='shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
                data-track-category='AGENT_ARTIFACT'
                data-track-name='EXPAND_ARTIFACT'
              >
                <MaximizeFourArrow size={16} className='shrink-0' />
              </button>
            )
          }
        />
      </div>

      {/* One row: the connect prompt (or audit) reads from the left, the decision
          buttons sit at the right end. `justify-between` with the prompt allowed
          to shrink keeps the buttons anchored even when there is no prompt. */}
      <div className='flex items-center justify-between gap-3 border-t border-border bg-foreground/[0.03] px-4 py-3'>
        <div className='flex min-w-0 items-center gap-3'>
          {decided && auditNode}
          {/* Only a CREATED draft has an agent to link to; a pending one goes to
              the MCP list instead. */}
          <AgentConnectPrompt agent={props.agent} agentExists={props.phase === 'created'} />
        </div>
        {!decided && actionControls}
      </div>

      <AgentPreview
        open={expanded}
        onOpenChange={setExpanded}
        messageId={messageId ?? ''}
        agent={props.agent}
        interactive={interactive}
        note={props.note}
        statePill={statePill}
        conversationId={conversationId ?? undefined}
        footer={decided ? auditNode : actionControls}
      />
    </CardShell>
  );
};
