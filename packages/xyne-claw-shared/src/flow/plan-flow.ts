/**
 * Plan card — renders the agent's plan as a FlowUI v2.0 `plan` component
 * (dashboard: components/flowUI/nodes/PlanNode.tsx). The component is
 * phase-discriminated:
 *
 *   proposed  → interactive: user toggles which todos to keep, then Approve.
 *               Todos carry `included` (bool). Emitted for a plan-mode proposal
 *               that requires user approval before execution.
 *   executing → running the accepted todos. Todos carry `status`. Emitted for
 *               live todo-write progress (auto mode) and for a trivial plan that
 *               skips approval.
 *   done      → all finished. Same shape as executing.
 *
 * Post once via Spaces postMessage({ flow }); then re-render IN PLACE via
 * updateMessage({ flowJSON }) as the phase/status changes (same screenId
 * `agent-plan` + same component id `plan` → the card updates without a new
 * message). Source-of-truth schema + zod validation lives in
 * @xyne/shared: shared/src/validation/flowSchema.ts (`planComponentSchema`).
 *
 * Paired with the `todo-write` / `todo-read` tools (tools/todo/todo-tools.ts),
 * the `propose-plan` terminal tool (plan mode), and the claw-auth
 * unified `ui-widget` progress + /webhook/result `pendingPlan` handlers that
 * do the post-then-update.
 */

import { FlowBuilder, type FlowComponent, type FlowDefinition } from './builder.js';

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface Todo {
  /** Stable id, reused across updates so the same row updates in place. */
  id: string;
  /** Short, user-facing description (renders live to the user). */
  title: string;
  status: TodoStatus;
}

/** Phase of the plan card — picks the component layout AND the todo shape. */
export type PlanPhase = 'proposed' | 'executing' | 'done';

/** Execution status the `plan` component renders (mirrors ExecTodoStatus in @xyne/shared). */
type ExecStatus = 'queued' | 'running' | 'done' | 'failed';

/** Internal todo status → the `plan` component's execution status vocabulary. */
const EXEC_STATUS: Record<TodoStatus, ExecStatus> = {
  pending: 'queued',
  in_progress: 'running',
  completed: 'done',
  failed: 'failed',
};

/** Stable component id — the `state.values` key PlanNode reads/writes and the
 *  key flow-action.ts reads the user's todo selection from. Do NOT change without
 *  updating both consumers. */
export const PLAN_COMPONENT_ID = 'plan';

/** Loose input shape: proposed plans come from propose-plan ({id,title}), live
 *  progress from todo-write ({id,title,status}). Missing status defaults sensibly
 *  per phase. */
export interface PlanTodoInput {
  id: string;
  title: string;
  status?: TodoStatus;
}

/**
 * Build the plan card as a single `plan` component. Deterministic (pure) so it
 * can be re-rendered on every phase/status change and diffed cheaply by the
 * client. `opts.data` carries flow-level routing (e.g. actionType 'plan-approval'
 * + agentSlug/conversationId/channelId/userId) that flow-action.ts reads on
 * Approve; webhook.ts wraps the result with withSpacesAppId.
 */
export function buildPlanFlow(
  todos: PlanTodoInput[],
  opts?: {
    title?: string;
    desc?: string;
    /** The detailed plan in markdown — rendered in the expanded plan view. Carried
     *  across all phases (authored once at propose time). */
    document?: string;
    screenId?: string;
    phase?: PlanPhase;
    data?: Record<string, unknown>;
    /** proposed only: mark the card replaced by a newer plan (greys out + disables Approve). */
    superseded?: boolean;
    /** proposed only: mark the plan explicitly REJECTED by the user (terminal, read-only). */
    rejected?: boolean;
    /** proposed only: display name of the human who rejected (audit). */
    decidedBy?: string;
    /** proposed only: ISO timestamp of the reject decision (audit "· <time>"). */
    decidedAt?: string;
    /** executing/done only: mark that the plan skipped the approval gate (trivial). */
    autoApproved?: boolean;
    /** executing/done only: display name of the human who approved (who-approved metadata). */
    approvedBy?: string;
    /** executing/done only: ISO timestamp of the approve decision (audit "· <time>"). */
    approvedAt?: string;
  },
): FlowDefinition {
  const phase: PlanPhase = opts?.phase ?? 'executing';
  const screenId = opts?.screenId ?? 'agent-plan';
  const title = opts?.title ?? 'Plan';
  const desc = opts?.desc;
  const document = opts?.document;

  const props: Record<string, unknown> =
    phase === 'proposed'
      ? {
          phase: 'proposed',
          title,
          ...(desc ? { desc } : {}),
          ...(document ? { document } : {}),
          todos: todos.map((t) => ({ id: t.id, text: t.title, included: true })),
          ...(opts?.superseded ? { superseded: true } : {}),
          ...(opts?.rejected ? { rejected: true } : {}),
          ...(opts?.decidedBy ? { decidedBy: opts.decidedBy } : {}),
          ...(opts?.decidedAt ? { decidedAt: opts.decidedAt } : {}),
        }
      : {
          phase,
          title,
          ...(desc ? { desc } : {}),
          ...(document ? { document } : {}),
          todos: todos.map((t) => ({
            id: t.id,
            text: t.title,
            status: EXEC_STATUS[t.status ?? 'pending'],
          })),
          ...(opts?.autoApproved ? { autoApproved: true } : {}),
          ...(opts?.approvedBy ? { approvedBy: opts.approvedBy } : {}),
          ...(opts?.approvedAt ? { approvedAt: opts.approvedAt } : {}),
        };

  const planComponent: FlowComponent = { id: PLAN_COMPONENT_ID, type: 'plan', props };

  // No flow title: FlowRenderer paints `flowJSON.title` as an <h2> ABOVE the
  // card, and the card's own TitleBlock already shows `props.title` — the same
  // string twice, once outside the artifact and once inside it.
  return new FlowBuilder(screenId)
    .addComponent(planComponent)
    .setData({ kind: 'plan', ...(opts?.data ?? {}) })
    .build();
}
