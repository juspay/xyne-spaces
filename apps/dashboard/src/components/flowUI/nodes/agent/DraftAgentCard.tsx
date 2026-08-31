import React, { useContext, useEffect, useState } from 'react';
import { MaximizeTwoArrow, Spinner } from '@xyne/icons';
import type { AgentDraftProps, FlowComponent } from '@xyne/shared';
import { useFlow } from '../../FlowContext';
import { useAgentProgress } from '../../../../hooks/useAgentProgress';
import { cn } from '../../../../utils/classNames';
import { AuditLine, CardShell, Mention, StatusChip } from '../cardPrimitives';
import Avatar from '../../../ui/Avatar/Avatar';
import { AgentPreview, InsideAgentPreviewContext } from './AgentPreview';

/**
 * The `agent` artifact's DRAFT variant — an agent an agent proposed, awaiting
 * the requester's decision.
 *
 *   pending  → Decline / Edit / Create Agent in the footer.
 *   created  → Created chip, audit footer.
 *   rejected → Declined chip, audit footer.
 *
 * Laid out to the "Agent Create" frame: a white inset panel carrying the
 * identity (kind + state, name, @slug, description) over a flat footer of
 * controls. The identity here is deliberately INLINE rather than the shared
 * AgentIdentityBlock — that block is the richer profile/preview presentation
 * (blue mention slug, model, capability chips, detail rows), and this frame
 * draws a plainer subset. AgentIdentityBlock still backs the expanded preview,
 * so the detailed view stays in one place.
 *
 * Capability chips are NOT rendered on the card for now (see AgentPreview for
 * the full list). Selection state is still seeded into flow-state below so the
 * server receives the complete capability set on approve — hiding the chips
 * must not silently narrow the grant.
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

  const statePill =
    props.phase === 'created' ? (
      <StatusChip label='Created' />
    ) : props.phase === 'rejected' ? (
      <StatusChip label='Declined' tone='rejected' />
    ) : (
      <StatusChip label='Draft' tone='muted' />
    );

  // Built as nodes, not a string, so the actor renders as a mention. No decision
  // time — the chin names who decided, not when; the message's own timestamp in
  // the thread already places it.
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
      </AuditLine>
    </div>
  );

  const approveLabel =
    pending === 'approve' ? 'Creating…' : agentRunning ? 'Agent is working…' : 'Create Agent';

  const interactive = decided ? undefined : { selected, onToggle: toggle, disabled: locked };

  // Footer button shapes from the frame: text-only for the secondary actions, a
  // bordered surface for the primary one.
  const ghostButton = cn(
    'inline-flex h-7 items-center gap-1.5 rounded-[10px] px-1.5',
    'text-sm font-semibold leading-5 text-foreground',
    'hover:bg-foreground/[0.04] disabled:cursor-not-allowed disabled:opacity-60',
  );
  const primaryButton = cn(
    'inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-background px-1.5',
    'text-sm font-semibold leading-5 text-foreground',
    'hover:bg-foreground/[0.04] disabled:cursor-not-allowed disabled:opacity-60',
  );

  // Decline / Edit / Create Agent — shared by the compact footer AND the
  // expanded preview footer (submit() closes the preview on a decision).
  const actionControls = (
    <div className='flex w-full items-center justify-between gap-3'>
      <button
        type='button'
        onClick={() => void submit('agent-draft-decline')}
        disabled={locked}
        className={cn(ghostButton, 'px-2.5')}
        data-track-category='AGENT_ARTIFACT'
        data-track-name='CLICK_DECLINE'
      >
        {pending === 'reject' && <Spinner size={14} className='animate-spin' />}
        {pending === 'reject' ? 'Declining…' : 'Decline'}
      </button>

      <div className='flex shrink-0 items-center gap-2'>
        {agentRunning && (
          <span className='hidden text-xs text-muted-foreground sm:inline'>
            Approve once it finishes.
          </span>
        )}
        {/* Placeholder from the frame — no edit flow exists yet. Rendered so the
            layout matches the design; wire it up when the behaviour is decided. */}
        <button
          type='button'
          onClick={() => {
            /* TODO: no edit flow yet — see the Agent Create frame. */
          }}
          disabled={locked}
          className={cn(ghostButton, 'px-2.5')}
          data-track-category='AGENT_ARTIFACT'
          data-track-name='CLICK_EDIT'
        >
          Edit
        </button>
        <button
          type='button'
          onClick={() => void submit('agent-draft-approve')}
          disabled={locked || agentRunning}
          className={cn(primaryButton, 'px-2.5')}
          data-track-category='AGENT_ARTIFACT'
          data-track-name='CLICK_APPROVE'
        >
          {(pending === 'approve' || agentRunning) && (
            <Spinner size={14} className='animate-spin' />
          )}
          {approveLabel}
        </button>
      </div>
    </div>
  );

  return (
    <CardShell style={node.style}>
      {/* Inset panel — the frame's white card sitting on the shell's fill.
          Bottom edge only: the shell already draws the outline, so bordering all
          four sides stacks two 1px strokes on every edge and reads as a heavy
          double rule. What is left is a single hairline dividing the body from
          the chin. Bottom radius stays 11px (the shell's 12px minus its 1px
          border) so the panel's curve sits concentric with the shell's. */}
      {/* Identical in every phase — the state reads from the chip and the chin
          (footer) alone, so a declined agent is presented exactly as a pending
          one rather than dimmed into a different-looking card. */}
      <div className='flex flex-col gap-4 rounded-b-[11px] border-b border-border bg-card/80 p-3'>
        <div className='flex h-6 items-center gap-1.5 pl-1'>
          <div className='flex min-w-0 flex-1 items-center gap-1.5'>
            <span className='text-sm font-semibold leading-5 tracking-[-0.5px] text-muted-foreground'>
              Agent
            </span>
            {statePill}
          </div>
          {!insidePreview && (
            <button
              type='button'
              onClick={(): void => setExpanded(true)}
              aria-label='Expand agent'
              className='shrink-0 rounded-[10px] p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
              data-track-category='AGENT_ARTIFACT'
              data-track-name='EXPAND_ARTIFACT'
            >
              <MaximizeTwoArrow size={16} className='shrink-0' />
            </button>
          )}
        </div>

        <div className='flex flex-col gap-3'>
          <div className='flex min-w-0 flex-col pl-1 gap-1'>
            <p className='break-words text-sm font-semibold leading-5 text-foreground'>
              {props.agent.name}
            </p>
            <span className='block truncate text-sm font-normal leading-5 tracking-[-0.07px] text-foreground'>
              @{props.agent.slug}
            </span>
          </div>

          {/* gap-1.5 is the frame's 6px. The body below is a <span>, not a second
              <p>, for the same reason as the slug above: `.jp-message-html p + p`
              (global.css) would add its own 8px on top of this gap and win, since
              the card renders inside the message-content root. */}
          {props.agent.description && (
            <div className='flex min-w-0 flex-col gap-1 px-1'>
              <p className='truncate text-sm font-semibold leading-5 text-foreground'>
                Description
              </p>
              <span className='block break-words text-sm font-normal leading-5 tracking-[-0.07px] text-foreground'>
                {props.agent.description}
              </span>
            </div>
          )}

          {/* `props.note` (the server's "not granted — no such tool" footnote) is
              intentionally NOT rendered here for now, alongside the hidden
              capability chips. The server still sends it and the expanded
              preview still shows it — this is a display choice, not a change to
              the wire contract. */}
        </div>
      </div>

      {/* min-h pins the chin to its tallest state — the pending buttons (h-7 + the
          16px of py-2). Without it the card contracts by ~12px the moment a
          decision lands (an audit line is shorter than a button row, and shorter
          again when there is no decider avatar), reflowing the thread under it. */}
      <div className='flex min-h-[44px] items-center justify-between gap-3 px-3 py-2'>
        {/* A decided card shows the audit line only. No connect prompt in either
            phase — it belongs with the capability chips, which this card no
            longer renders; the expanded preview still surfaces both. */}
        {decided ? auditNode : actionControls}
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
