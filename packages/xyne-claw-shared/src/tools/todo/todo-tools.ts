/**
 * Plan tracking tools — `todo-write` / `todo-read`.
 *
 * The agent maintains an explicit plan (todo list) for multi-step tasks. Each
 * `todo-write` call replaces the full list, stores it in per-run state, and
 * publishes a typed `ui-widget` event, which
 * renders/updates the live plan card in Spaces (see flow/plan-flow.ts + the
 * claw-auth handler). `todo-read` returns the current list so the agent can
 * re-orient without re-deriving the plan.
 *
 * State is a module-level Map keyed by sessionId. A run executes on a single
 * claw pod, so no cross-pod sharing is needed. Clear it when the run ends
 * (claw run dispatcher should call clearPlan(sessionId) on completion).
 */

import type { ToolDefinition, ToolExecutionContext } from '../types.js';
import type { Todo, TodoStatus } from '../../flow/plan-flow.js';
import { publishUiWidget } from '../ui-widget.js';

const VALID_STATUS: TodoStatus[] = ['pending', 'in_progress', 'completed', 'failed'];

// ── Per-run plan state ──────────────────────────────────────────────────────
const planStore = new Map<string, Todo[]>();

export function getPlan(sessionId: string): Todo[] {
  return planStore.get(sessionId) ?? [];
}

export function clearPlan(sessionId: string): void {
  planStore.delete(sessionId);
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function renderPlanText(todos: Todo[]): string {
  if (todos.length === 0) return 'No todos yet.';
  const g: Record<TodoStatus, string> = {
    pending: '[ ]',
    in_progress: '[~]',
    completed: '[x]',
    failed: '[!]',
  };
  return todos.map((t, i) => `${i + 1}. ${g[t.status]} ${t.title}`).join('\n');
}

function normalize(raw: unknown[]): Todo[] {
  return raw.map((t, i) => {
    const o = (t ?? {}) as Record<string, unknown>;
    const status = VALID_STATUS.includes(o['status'] as TodoStatus)
      ? (o['status'] as TodoStatus)
      : 'pending';
    // Both fields must come out non-empty: publishUiWidget validates the plan
    // widget before dispatch, and a blank title would fail the whole todo-write
    // rather than render one blank row. A numbered placeholder is a better
    // outcome than an errored plan update on a tool this hot.
    const title = String(o['title'] ?? '').trim().slice(0, 300);
    return {
      id: String(o['id'] ?? i).trim() || String(i),
      title: title || `Step ${i + 1}`,
      status,
    };
  });
}

// ── Tools ─────────────────────────────────────────────────────────────────
export const todoWriteTool: ToolDefinition = {
  slug: 'todo-write',
  name: 'Update plan',
  source: 'builtin',
  description:
    'Create or update your plan as a todo list for a multi-step task. Pass the FULL, ordered list every ' +
    'call — it REPLACES the previous one. Each todo is {id, title, status} with status ∈ ' +
    'pending|in_progress|completed|failed. Keep EXACTLY ONE todo in_progress at a time, and mark a todo ' +
    'completed the moment it is done (do not batch). The list renders live to the user, so use clear, ' +
    'user-facing titles. Skip this tool for trivial one-step requests.',
  inputSchema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'The full, ordered todo list (replaces the previous list).',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Stable id; reuse across updates so a row updates in place.' },
            title: { type: 'string', description: 'Short, user-facing description.' },
            status: { type: 'string', enum: VALID_STATUS },
          },
          required: ['id', 'title', 'status'],
        },
      },
    },
    required: ['todos'],
  },
  execute: async (params: Record<string, unknown>, ctx?: ToolExecutionContext): Promise<string> => {
    const raw = Array.isArray(params['todos']) ? (params['todos'] as unknown[]) : [];
    const todos = normalize(raw);
    if (todos.filter((t) => t.status === 'in_progress').length > 1) {
      return 'Error: only one todo may be in_progress at a time. Fix the statuses and call todo-write again.';
    }
    if (ctx?.sessionId) planStore.set(ctx.sessionId, todos);
    try {
      await publishUiWidget(ctx, {
        id: 'plan',
        type: 'plan',
        operation: 'upsert',
        payload: { todos },
      });
    } catch (err) {
      return `Error publishing plan widget: ${err instanceof Error ? err.message : String(err)}`;
    }
    return `Plan updated (${todos.length} todos):\n${renderPlanText(todos)}`;
  },
};

export const todoReadTool: ToolDefinition = {
  slug: 'todo-read',
  name: 'Read plan',
  source: 'builtin',
  description:
    'Read your current plan (todo list). Use this to re-orient before continuing — especially after a long ' +
    'stretch of work or a context compaction — instead of re-deriving the whole plan.',
  inputSchema: { type: 'object', properties: {} },
  execute: async (_params: Record<string, unknown>, ctx?: ToolExecutionContext): Promise<string> => {
    const todos = ctx?.sessionId ? getPlan(ctx.sessionId) : [];
    return renderPlanText(todos);
  },
};

export const todoTools: ToolDefinition[] = [todoWriteTool, todoReadTool];

/** Slugs of the plan-tracking tools — single source (derived from the defs). */
export const PLAN_TOOL_SLUGS: readonly string[] = todoTools.map((t) => t.slug);

/** True if a tool name/slug is one of the plan-tracking tools. */
export function isPlanToolSlug(name: string): boolean {
  return PLAN_TOOL_SLUGS.includes(name);
}
