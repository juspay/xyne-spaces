/**
 * The agent's plan (todo checklist) as claw-auth stores it: one
 * `{ type: 'plan', id: 'plan', title?, todos }` element at the end of a turn's
 * `parts`. It is not a timeline part — `normalizeAssistantParts` drops it — so
 * the history read pulls it out here to redraw the plan card on reload.
 */
import type { PlanTodo } from '../../components/Chat/XyneAISidebar/utils/XyneAITypes';

const PLAN_TODO_STATUSES: ReadonlySet<PlanTodo['status']> = new Set([
  'pending',
  'in_progress',
  'completed',
  'failed',
  'stopped',
]);

/** Accept a todo list from the wire, dropping malformed items. */
export function toPlanTodos(value: unknown): PlanTodo[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const todos: PlanTodo[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (typeof item['title'] !== 'string' || !item['title']) continue;
    const status = PLAN_TODO_STATUSES.has(item['status'] as PlanTodo['status'])
      ? (item['status'] as PlanTodo['status'])
      : 'pending';
    todos.push({
      ...(typeof item['id'] === 'string' && item['id'] ? { id: item['id'] } : {}),
      title: item['title'],
      status,
    });
  }
  return todos.length > 0 ? todos : undefined;
}

/** The stored plan in a message's raw `parts`, if any. */
export function planFromParts(parts: unknown): { todos: PlanTodo[]; title?: string } | null {
  if (!Array.isArray(parts)) return null;
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i] as Record<string, unknown> | null;
    if (!part || typeof part !== 'object' || part['type'] !== 'plan') continue;
    const todos = toPlanTodos(part['todos']);
    if (!todos) return null;
    const title = typeof part['title'] === 'string' && part['title'] ? part['title'] : undefined;
    return { todos, ...(title ? { title } : {}) };
  }
  return null;
}

/**
 * A run that ended without completing (stopped, failed, errored) leaves no
 * step running: the one in progress becomes `stopped`. Returns the same array
 * when nothing was in progress, so callers can skip a re-render.
 */
export function stopOpenPlanTodos(todos: PlanTodo[]): PlanTodo[] {
  if (!todos.some(todo => todo.status === 'in_progress')) return todos;
  return todos.map(todo =>
    todo.status === 'in_progress' ? { ...todo, status: 'stopped' as const } : todo,
  );
}
