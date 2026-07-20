import React, { useEffect } from 'react';
import {
  MaximizeFourArrow,
  Spinner,
  CheckTickSingle,
  MultipleCrossCancelDefault,
} from '@xyne/icons';
import { useFlow } from '../FlowContext';
import type { FlowComponent, PlanProps, ExecTodoStatus } from '@xyne/shared';
import { cn } from '../../../utils/classNames';

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

const ProposedPlan: React.FC<{
  node: FlowComponent;
  props: Extract<PlanProps, { phase: 'proposed' }>;
}> = ({ node, props }) => {
  const { state, updateFieldValue } = useFlow();

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

  const toggle = (id: string): void => {
    if (state.submitting) return;
    const next = new Set(includedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    updateFieldValue(node.id, Array.from(next));
  };

  return (
    <CardShell style={node.style}>
      <div className='flex flex-col gap-3 p-4'>
        <div className='flex flex-col gap-[9px]'>
          <Header />
          <TitleBlock title={props.title} desc={props.desc} />
        </div>

        <div className='h-px w-full bg-border' />

        <p className='text-sm font-medium leading-[1.2] text-muted-foreground tabular-nums'>
          {includedIds.size} To-dos Selected
        </p>

        <div className='flex flex-col gap-3'>
          {props.todos.map(todo => (
            <button
              key={todo.id}
              type='button'
              onClick={() => toggle(todo.id)}
              aria-pressed={includedIds.has(todo.id)}
              disabled={state.submitting}
              className={cn(
                'flex items-start gap-[7px] text-left',
                'disabled:cursor-not-allowed disabled:opacity-60',
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

      <div className='flex items-center gap-3 border-t border-border bg-foreground/[0.03] px-4 py-3'>
        <button
          type='button'
          disabled={includedIds.size === 0}
          className={cn(
            'rounded-lg border border-border bg-background px-2 py-1.5',
            'text-sm font-medium leading-[1.2] text-foreground',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
          data-track-category='PLAN_ARTIFACT'
          data-track-name='CLICK_APPROVE'
        >
          Approve
        </button>
      </div>
    </CardShell>
  );
};

const ExecutingPlan: React.FC<{
  node: FlowComponent;
  props: Extract<PlanProps, { phase: 'executing' | 'done' }>;
}> = ({ node, props }) => {
  const doneCount = props.todos.filter(t => t.status === 'done').length;

  return (
    <CardShell style={node.style}>
      <div className='flex flex-col gap-3 p-4'>
        <div className='flex flex-col gap-[9px]'>
          <Header chip={<StatusChip label={props.phase === 'done' ? 'Completed' : 'Approved'} />} />
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
    className='flex w-full max-w-[450px] flex-col overflow-hidden rounded-xl border border-border bg-muted/40'
    style={style}
  >
    {children}
  </div>
);

const Header: React.FC<{ chip?: React.ReactNode }> = ({ chip }) => (
  <div className='flex items-center justify-between'>
    <div className='flex items-center gap-2'>
      <span className='font-mono text-sm leading-[18px] tracking-[0.2px] text-muted-foreground'>
        Plan
      </span>
      {chip}
    </div>
    <MaximizeFourArrow size={16} className='shrink-0 text-muted-foreground' />
  </div>
);

const StatusChip: React.FC<{ label: string }> = ({ label }) => (
  <span className='flex h-[18px] items-center'>
    <span className='rounded px-1 py-px text-xs font-semibold leading-[18px] tracking-[0.2px] bg-[var(--plan-chip-approved-bg)] text-[var(--plan-chip-approved-fg)]'>
      {label}
    </span>
  </span>
);

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
