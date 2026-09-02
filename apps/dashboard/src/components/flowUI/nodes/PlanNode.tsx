import React, { useContext, useEffect, useMemo, useState } from 'react';
import {
  MaximizeFourArrow,
  Spinner,
  CheckTickSingle,
  MultipleCrossCancelDefault,
} from '@xyne/icons';
import { useFlow } from '../FlowContext';
import type { FlowComponent, PlanProps, ExecTodoStatus } from '@xyne/shared';
import { WidgetPreview, InsideWidgetPreviewContext } from './WidgetPreview';
import { useAgentProgress } from '../../../hooks/useAgentProgress';
import { cn } from '../../../utils/classNames';
import { MarkdownMessageRenderer } from '../../ui/MessageBubble/MarkdownMessageRenderer';
import { createMarkdownComponents } from '../../../utils/markdownComponents';
import { Button } from '../../ui/Button/Button';

/**
 * Plan artifact — an agent-authored, interactive plan card.
 *
 * `props.phase` is the discriminant; it picks the layout AND the todo shape:
 *
 *   proposed  → user picks todos, then approves. Todos carry `included` (bool).
 *               Inclusion is the ONLY thing kept in client flow-state; on approval
 *               the backend drops excluded todos and re-tags the rest with a status.
 *   executing → running the accepted todos. Todos carry `status`.
 *   done      → all finished. Same shape as executing.
 *
 * Todo `status` (executing/done, read-only, from props → live updates flow through):
 *   queued ○ · running ◌ · done ✓ · failed ✗
 *
 * A rejected todo has no status — it simply isn't in the executing/done list.
 * Render splits accordingly: PlanNode → ProposedPlan | ExecutingPlan.
 *
 * ── Wire contract (backend emits this) ───────────────────────────────────────
 * The plan is one component inside a FlowJSON FlowDefinition. Source of truth +
 * zod validation: shared/src/validation/flowSchema.ts (`planComponentSchema`).
 * The whole FlowDefinition is JSON-stringified, `"`→`&quot;` escaped, and stored
 * in messages.content as: <div data-flow-json="…">Flow JSON</div>. Post once, then
 * `updateMessage` the SAME screenId to advance phases (proposed → executing → done).
 *
 *   { version: '2.0', screenId: 'agent-plan', title: 'Plan',
 *     state: { values:{}, touched:{}, errors:{}, submitting:false,
 *              submitted:false, history:[], loadingComponentIds:[] },  // always empty
 *     components: [{
 *       id: 'plan', type: 'plan',
 *       props:
 *         // phase 'proposed'
 *         { phase:'proposed', title, desc?, todos: [{ id, text, included: boolean }] }
 *         // phase 'executing' | 'done'  (excluded todos already dropped)
 *         { phase, title, desc?, todos: [{ id, text, status: 'queued'|'running'|'done'|'failed' }] }
 *     }] }
 *
 * `id` must be stable across updates (rows reconcile by it). props is .strict() —
 * unknown keys are rejected; inclusion and execution shapes never mix.
 */
interface PlanNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

export const PlanNode: React.FC<PlanNodeProps> = ({ node }) => {
  const props = node.props as PlanProps | undefined;
  if (!props) return null;

  if (props.phase === 'proposed') {
    return <ProposedPlan node={node} props={props} />;
  }
  return <ExecutingPlan node={node} props={props} />;
};

/**
 * Optional plan-card metadata the shared `PlanProps` type does not (currently)
 * declare: the detailed document, the approve/reject audit fields, and the
 * superseded/auto-approved flags. The backend may still emit them, so the card
 * reads them through this typed view (`props as typeof props & PlanCardMeta`) —
 * every access stays `string`/`boolean` `| undefined` instead of an unsafe
 * `any`/error-typed read.
 */
interface PlanCardMeta {
  document?: string | undefined;
  superseded?: boolean | undefined;
  rejected?: boolean | undefined;
  decidedBy?: string | undefined;
  decidedAt?: string | undefined;
  autoApproved?: boolean | undefined;
  approvedBy?: string | undefined;
  approvedAt?: string | undefined;
}

const ProposedPlan: React.FC<{
  node: FlowComponent;
  props: Extract<PlanProps, { phase: 'proposed' }>;
}> = ({ node, props }) => {
  const { state, updateFieldValue, executeAction, conversationId, messageId } = useFlow();
  // A copy of this card lives inside its own widget-preview thread panel; hide the
  // Maximize there so it can't open a nested preview.
  const insidePreview = useContext(InsideWidgetPreviewContext);
  // Which decision is in flight (issue 5): drives the "Approving…"/"Rejecting…"
  // button state until the backend confirms and the card re-renders.
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Optional plan-card metadata (see PlanCardMeta) read type-safely.
  const meta = props as typeof props & PlanCardMeta;
  // Terminal read-only states: superseded (agent re-planned) or rejected (the
  // user tapped Reject). No toggling, no buttons — just the audit at the bottom.
  const superseded = meta.superseded === true;
  const rejected = meta.rejected === true;
  const decidedBy = meta.decidedBy;
  const terminal = superseded || rejected;

  // Block approval while a run is active in this thread. Approving mid-run
  // dispatches a second run that collides with the active one at the runtime
  // session lock (one dies "session_locked" and re-fires as a duplicate/branch).
  // The server also fail-closes this, but disabling the button is the clearer UX.
  const { agents } = useAgentProgress(conversationId || undefined);
  const agentRunning = agents.length > 0;

  const stored = state.values[node.id];
  const seeded = Array.isArray(stored);
  const includedIds = new Set<string>(
    seeded ? (stored as string[]) : props.todos.filter(t => t.included).map(t => t.id),
  );

  useEffect(() => {
    if (state.values[node.id] === undefined) {
      updateFieldValue(
        node.id,
        props.todos.filter(t => t.included).map(t => t.id),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  const locked = state.submitting || terminal || pending !== null;

  const toggle = (id: string): void => {
    if (locked) return;
    const next = new Set(includedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    updateFieldValue(node.id, Array.from(next));
  };

  const submit = async (actionId: 'plan-approve' | 'plan-reject'): Promise<void> => {
    if (locked || agentRunning) return;
    if (actionId === 'plan-approve' && includedIds.size === 0) return;
    setPending(actionId === 'plan-approve' ? 'approve' : 'reject');
    try {
      await executeAction({ type: 'submit', actionId });
      // On a decision, drop the expanded preview back to the thread view.
      setExpanded(false);
    } finally {
      setPending(null);
    }
  };

  const approveLabel =
    pending === 'approve' ? 'Approving…' : agentRunning ? 'Agent is working…' : 'Approve';
  const rejectLabel = pending === 'reject' ? 'Rejecting…' : 'Reject';

  const auditText = rejected
    ? withDecisionTime(decidedBy ? `Rejected by ${decidedBy}` : 'Rejected', meta.decidedAt)
    : 'Replaced by a newer plan';

  // Approve / Reject controls, shared by the compact card footer AND the expanded
  // preview footer (submit() closes the preview on a decision).
  const actionControls = (
    <div className='flex flex-wrap items-center gap-2'>
      <Button
        type='button'
        variant='ghost'
        onClick={() => void submit('plan-approve')}
        disabled={includedIds.size === 0 || locked || agentRunning}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5',
          'text-sm font-medium leading-[1.2] text-foreground',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
        data-track-category='PLAN_ARTIFACT'
        data-track-name='CLICK_APPROVE'
        trackId='plan_approve'
      >
        {(pending === 'approve' || agentRunning) && <Spinner size={14} className='animate-spin' />}
        {approveLabel}
      </Button>
      <Button
        type='button'
        variant='ghost'
        onClick={() => void submit('plan-reject')}
        disabled={locked || agentRunning}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border border-transparent px-2 py-1.5',
          'text-sm font-medium leading-[1.2] text-muted-foreground',
          'hover:bg-foreground/[0.04] hover:text-foreground',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
        data-track-category='PLAN_ARTIFACT'
        data-track-name='CLICK_REJECT'
        trackId='plan_reject'
      >
        {pending === 'reject' && <Spinner size={14} className='animate-spin' />}
        {rejectLabel}
      </Button>
      {agentRunning && (
        <span className='text-xs text-muted-foreground'>Approve once it finishes.</span>
      )}
    </div>
  );

  // Interactive checklist for the expanded view — SAME selection state/toggle as
  // the compact card (radios via FilledDot/EmptyCircle), roomier max-view styling.
  const previewTodos = (
    <div className='flex flex-col gap-2'>
      <p className='text-sm font-medium leading-[1.2] text-muted-foreground tabular-nums'>
        {terminal ? `${props.todos.length} To-dos` : `${includedIds.size} To-dos Selected`}
      </p>
      <div className='flex flex-col'>
        {props.todos.map(todo => (
          <button
            key={todo.id}
            type='button'
            onClick={() => toggle(todo.id)}
            aria-pressed={includedIds.has(todo.id)}
            disabled={locked}
            className={cn(
              'flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
              !terminal && 'hover:bg-foreground/[0.03]',
              'disabled:cursor-not-allowed',
              !terminal && 'disabled:opacity-60',
            )}
            data-track-category='PLAN_ARTIFACT'
            data-track-name='TOGGLE_TODO_MAX'
          >
            <DotSlot>{includedIds.has(todo.id) ? <FilledDot /> : <EmptyCircle />}</DotSlot>
            <span className='text-sm leading-[1.4] text-foreground/90'>{todo.text}</span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <CardShell style={node.style}>
      <div className={cn('flex flex-col gap-3 p-4', terminal && 'opacity-60')}>
        <div className='flex flex-col gap-[9px]'>
          <Header
            onExpand={insidePreview ? undefined : (): void => setExpanded(true)}
            chip={terminal ? <StatusChip label='Rejected' tone='rejected' /> : undefined}
          />
          <TitleBlock title={props.title} desc={props.desc} />
        </div>

        <div className='h-px w-full bg-border' />

        <p className='text-sm font-medium leading-[1.2] text-muted-foreground tabular-nums'>
          {terminal ? `${props.todos.length} To-dos` : `${includedIds.size} To-dos Selected`}
        </p>

        <div className='flex flex-col gap-3'>
          {props.todos.map(todo => (
            <button
              key={todo.id}
              type='button'
              onClick={() => toggle(todo.id)}
              aria-pressed={includedIds.has(todo.id)}
              disabled={locked}
              className={cn(
                'flex items-start gap-[7px] text-left',
                'disabled:cursor-not-allowed',
                !terminal && 'disabled:opacity-60',
              )}
              data-track-category='PLAN_ARTIFACT'
              data-track-name='TOGGLE_TODO'
            >
              <DotSlot>{includedIds.has(todo.id) ? <FilledDot /> : <EmptyCircle />}</DotSlot>
              <TodoText text={todo.text} />
            </button>
          ))}
        </div>
      </div>

      {/* Footer — audit for a decided plan, or the Approve / Reject actions. */}
      <div className='border-t border-border bg-foreground/[0.03] px-4 py-3'>
        {terminal ? <AuditLine text={auditText} /> : actionControls}
      </div>

      <WidgetPreview
        open={expanded}
        onOpenChange={setExpanded}
        idPrefix='plan-preview'
        label='Plan'
        title={props.title}
        description={props.desc}
        conversationId={conversationId ?? undefined}
        footer={terminal ? <AuditLine text={auditText} /> : actionControls}
        tracking={{ category: 'PLAN_ARTIFACT', closeName: 'CLOSE_PLAN_PREVIEW' }}
      >
        <PlanPreviewContent
          messageId={messageId ?? ''}
          title={props.title}
          desc={props.desc}
          todos={previewTodos}
          document={meta.document}
        />
      </WidgetPreview>
    </CardShell>
  );
};

const ExecutingPlan: React.FC<{
  node: FlowComponent;
  props: Extract<PlanProps, { phase: 'executing' | 'done' }>;
}> = ({ node, props }) => {
  const { messageId, conversationId } = useFlow();
  const insidePreview = useContext(InsideWidgetPreviewContext);
  const [expanded, setExpanded] = useState(false);
  const doneCount = props.todos.filter(t => t.status === 'done').length;
  const progressText = `${doneCount} of ${props.todos.length} completed`;
  // Optional plan-card metadata (see PlanCardMeta) read type-safely.
  const meta = props as typeof props & PlanCardMeta;

  // Chip: Completed once done; otherwise "Auto-approved" when the plan skipped
  // the approval gate (trivial), so the user knows why it started without them.
  const chipLabel =
    props.phase === 'done' ? 'Completed' : meta.autoApproved ? 'Auto-approved' : 'Approved';

  // Who-approved audit — shown at the BOTTOM of the artifact, with the decision
  // time appended ("· <time>") when known.
  const auditText = meta.autoApproved
    ? withDecisionTime('Auto-approved by the agent', meta.approvedAt)
    : meta.approvedBy
      ? withDecisionTime(`Approved by ${meta.approvedBy}`, meta.approvedAt)
      : null;

  // Live status checklist for the expanded view (roomier max-view styling) + the
  // preview footer (live progress + audit).
  const previewTodos = (
    <div className='flex flex-col gap-2'>
      <p className='text-sm font-medium leading-[1.2] text-muted-foreground tabular-nums'>
        {progressText}
      </p>
      <div className='flex flex-col'>
        {props.todos.map(todo => (
          <div key={todo.id} className='flex items-start gap-3 rounded-lg px-3 py-2.5'>
            <DotSlot>
              <ExecDot status={todo.status} />
            </DotSlot>
            <span className='text-sm leading-[1.4] text-foreground/90'>{todo.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
  const previewFooter = (
    <div className='flex flex-col gap-1'>
      <span className='text-sm font-medium leading-[1.2] text-muted-foreground tabular-nums'>
        {progressText}
      </span>
      {auditText && <AuditLine text={auditText} />}
    </div>
  );

  return (
    <CardShell style={node.style}>
      <div className='flex flex-col gap-3 p-4'>
        <div className='flex flex-col gap-[9px]'>
          <Header
            chip={<StatusChip label={chipLabel} />}
            onExpand={insidePreview ? undefined : (): void => setExpanded(true)}
          />
          <TitleBlock title={props.title} desc={props.desc} />
        </div>

        <div className='h-px w-full bg-border' />

        <p className='text-sm font-medium leading-[1.2] text-muted-foreground tabular-nums'>
          {doneCount} of {props.todos.length} completed
        </p>

        <div className='flex flex-col gap-3'>
          {props.todos.map(todo => (
            <div key={todo.id} className='flex items-start gap-[7px]'>
              <DotSlot>
                <ExecDot status={todo.status} />
              </DotSlot>
              <TodoText text={todo.text} />
            </div>
          ))}
        </div>
      </div>

      {auditText && (
        <div className='border-t border-border bg-foreground/[0.03] px-4 py-3'>
          <AuditLine text={auditText} />
        </div>
      )}

      <WidgetPreview
        open={expanded}
        onOpenChange={setExpanded}
        idPrefix='plan-preview'
        label='Plan'
        title={props.title}
        description={props.desc}
        conversationId={conversationId ?? undefined}
        footer={previewFooter}
        tracking={{ category: 'PLAN_ARTIFACT', closeName: 'CLOSE_PLAN_PREVIEW' }}
      >
        <PlanPreviewContent
          messageId={messageId ?? ''}
          title={props.title}
          desc={props.desc}
          todos={previewTodos}
          document={meta.document}
        />
      </WidgetPreview>
    </CardShell>
  );
};

const ExecDot: React.FC<{ status: ExecTodoStatus }> = ({ status }) => {
  switch (status) {
    case 'running':
      return <Spinner size={16} className='animate-spin text-muted-foreground' />;
    case 'done':
      return (
        <span className='flex size-4 items-center justify-center rounded-full bg-foreground/80'>
          <CheckTickSingle
            size={12}
            strokeWidth={1.33}
            absoluteStrokeWidth
            className='text-background'
          />
        </span>
      );
    case 'failed':
      return (
        <span className='flex size-4 items-center justify-center rounded-full bg-destructive'>
          <MultipleCrossCancelDefault size={10} className='text-white' />
        </span>
      );
    default: // 'queued'
      return <EmptyCircle />;
  }
};

const CardShell: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties | undefined;
}> = ({ children, style }) => (
  <div
    // Fixed width so the card never resizes with its content (long/short todos
    // render at the same width). `max-w-full` caps it only on containers narrower
    // than 450px (mobile). Height stays auto — it grows with the todo list.
    className='flex w-[450px] max-w-full flex-col overflow-hidden rounded-xl border border-border bg-muted/40'
    style={style}
  >
    {children}
  </div>
);

const Header: React.FC<{ chip?: React.ReactNode; onExpand?: (() => void) | undefined }> = ({
  chip,
  onExpand,
}) => (
  <div className='flex items-center justify-between'>
    {/* No "Plan" label — the card's own title says what it is. */}
    <div className='flex items-center gap-2'>{chip}</div>
    {/* No Maximize when the card is rendered inside a PlanPreview's own thread
        panel (onExpand omitted) — prevents stacking a second full-screen preview. */}
    {onExpand && (
      <button
        type='button'
        onClick={onExpand}
        aria-label='Expand plan'
        className='shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
        data-track-category='PLAN_ARTIFACT'
        data-track-name='EXPAND_PLAN'
      >
        <MaximizeFourArrow size={16} className='shrink-0' />
      </button>
    )}
  </div>
);

const StatusChip: React.FC<{ label: string; tone?: 'approved' | 'muted' | 'rejected' }> = ({
  label,
  tone = 'approved',
}) => (
  <span className='flex h-[18px] items-center'>
    <span
      className={cn(
        'rounded px-1 py-px text-xs font-semibold leading-[18px] tracking-[0.2px]',
        tone === 'muted' && 'bg-muted text-muted-foreground',
        // Mild red — a superseded plan the agent re-planned away from.
        tone === 'rejected' && 'bg-destructive/10 text-destructive',
        tone === 'approved' &&
          'bg-[var(--plan-chip-approved-bg)] text-[var(--plan-chip-approved-fg)]',
      )}
    >
      {label}
    </span>
  </span>
);

// Small muted audit line shown in a card footer — "Approved by <name>",
// "Auto-approved by the agent", or "Rejected by <name>", each optionally suffixed
// with the decision time.
const AuditLine: React.FC<{ text: string }> = ({ text }) => (
  <span className='text-xs leading-[1.2] text-muted-foreground'>{text}</span>
);

// Format an ISO decision timestamp for the audit footer. Relative within the
// first day ("just now", "5 mins ago", "1 hr ago"); absolute after 24h, e.g.
// "Jul 26, 2:34 PM". Returns null for a missing/invalid value so callers omit
// the "· <time>" suffix.
const formatDecisionTime = (iso?: string): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  // Relative for the first day; a future timestamp (clock skew) falls through
  // to the absolute format rather than showing a negative "ago".
  const diffMs = Date.now() - d.getTime();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  if (diffMs >= 0 && diffMs < ONE_DAY_MS) {
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} ${mins === 1 ? 'min' : 'mins'} ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs} ${hrs === 1 ? 'hr' : 'hrs'} ago`;
  }

  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

// Join an audit label with its (optional) decision time: "Approved by X · 2:34 PM".
const withDecisionTime = (label: string, iso?: string): string => {
  const t = formatDecisionTime(iso);
  return t ? `${label} · ${t}` : label;
};

const TitleBlock: React.FC<{ title: string; desc?: string | undefined }> = ({ title, desc }) => (
  <div className='flex flex-col'>
    <p className='text-lg font-semibold leading-[1.2] text-foreground'>{title}</p>
    {desc && <p className='text-sm leading-[1.5] tracking-[-0.15px] text-foreground/80'>{desc}</p>}
  </div>
);

const DotSlot: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className='relative flex h-[18px] w-6 shrink-0 items-center justify-center'>
    {children}
  </span>
);

const FilledDot: React.FC = () => (
  <span className='flex size-4 items-center justify-center rounded-full bg-foreground/80'>
    <span className='size-1 rounded-full bg-background' />
  </span>
);

const EmptyCircle: React.FC = () => (
  <span className='size-4 rounded-full border-[1.6px] border-foreground/20' />
);

const TodoText: React.FC<{ text: string }> = ({ text }) => (
  <p className='text-sm leading-[1.2] text-foreground/80'>{text}</p>
);

const PlanPreviewContent: React.FC<{
  messageId: string;
  title: string;
  desc?: string | undefined;
  document?: string | undefined;
  todos?: React.ReactNode;
}> = ({ messageId, title, desc, document, todos }) => {
  const markdownComponents = useMemo(
    () => createMarkdownComponents(messageId || 'plan-document'),
    [messageId],
  );

  return (
    <>
      <div className='flex flex-col gap-1'>
        <h1 className='text-2xl font-semibold leading-[1.2] text-foreground'>{title}</h1>
        {desc && (
          <p className='text-sm leading-[1.5] tracking-[-0.15px] text-foreground/70'>{desc}</p>
        )}
      </div>
      {todos}
      {document && (
        <>
          <div className='h-px w-full bg-border' />
          <MarkdownMessageRenderer content={document} markdownComponents={markdownComponents} />
        </>
      )}
    </>
  );
};
