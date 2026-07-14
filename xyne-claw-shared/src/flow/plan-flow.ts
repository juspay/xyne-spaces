/**
 * Plan card — renders the agent's live todo list as a read-only FlowUI v2.0
 * card. Post once via Spaces postMessage({ flow }); then re-render IN PLACE via
 * updateMessage({ flowJSON }) as statuses change (same messageId). No buttons —
 * it's a status display, not an interactive form.
 *
 * Paired with the `todo-write` / `todo-read` tools (tools/todo/todo-tools.ts)
 * and the claw-auth /webhook/progress `kind:"plan"` handler that does the
 * post-then-update.
 */

import { FlowBuilder, type FlowDefinition } from './builder.js';

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface Todo {
  /** Stable id, reused across updates so the same row updates in place. */
  id: string;
  /** Short, user-facing description (renders live to the user). */
  title: string;
  status: TodoStatus;
}

const GLYPH: Record<TodoStatus, string> = {
  pending: '☐',
  in_progress: '⏳',
  completed: '✅',
  failed: '❌',
};

const VARIANT: Record<TodoStatus, 'default' | 'muted' | 'success' | 'warning' | 'danger'> = {
  pending: 'muted',
  in_progress: 'default',
  completed: 'success',
  failed: 'danger',
};

/**
 * Build the plan card. Deterministic (pure) so it can be re-rendered on every
 * status change and diffed cheaply by the client.
 */
export function buildPlanFlow(
  todos: Todo[],
  opts?: { title?: string; screenId?: string },
): FlowDefinition {
  const done = todos.filter((t) => t.status === 'completed').length;
  const failed = todos.filter((t) => t.status === 'failed').length;
  const summary = `${done}/${todos.length} done${failed ? ` · ${failed} failed` : ''}`;

  const b = new FlowBuilder(opts?.screenId ?? 'agent-plan')
    .setTitle(opts?.title ?? 'Plan')
    .addText('summary', `*${summary}*`, { variant: 'muted', size: 'sm' })
    .addDivider('div');

  todos.forEach((t, i) => {
    // Bold the row that's actively in progress so the user can see "where we are".
    const label = t.status === 'in_progress' ? `*${t.title}*` : t.title;
    b.addText(`todo-${t.id || i}`, `${GLYPH[t.status]} ${label}`, { variant: VARIANT[t.status] });
  });

  return b.setData({ kind: 'plan' }).build();
}
