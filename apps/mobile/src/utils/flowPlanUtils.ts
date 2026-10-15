export type PlanComponentLike = {
  type?: unknown;
  props?: Record<string, unknown>;
  children?: PlanComponentLike[];
};

export type FlowPlanStatusTone = 'pending' | 'in_progress' | 'completed' | 'failed';

export type FlowPlanMarkdownHeader = {
  title: string;
  statusLabel: string;
  statusTone: FlowPlanStatusTone;
  restMarkdown: string;
};

export type PlanTodoDisplayStatus = 'done' | 'running' | 'queued' | 'failed' | 'included';

export type PlanTodoViewModel = {
  id: string;
  text: string;
  displayStatus: PlanTodoDisplayStatus;
};

export type PlanComponentViewModel = {
  title: string;
  statusLabel: string;
  statusTone: FlowPlanStatusTone;
  description: string;
  completedCount: number;
  totalCount: number;
  todos: PlanTodoViewModel[];
};

export type PlanHeaderStatus = {
  statusLabel: string;
  statusTone: FlowPlanStatusTone;
};

export type PlanTextNormalizer = (text: string) => string;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getStringProp = (props: Record<string, unknown> | undefined, key: string): string => {
  const value = props?.[key];
  return typeof value === 'string' ? value.trim() : '';
};

export const isPlanTodoCompleted = (status: string): boolean => {
  const normalizedStatus = status.trim().toLowerCase();
  return (
    normalizedStatus === 'done' ||
    normalizedStatus === 'completed' ||
    normalizedStatus === 'complete'
  );
};

export const normalizePlanStatusTone = (status: string): FlowPlanStatusTone | null => {
  const normalizedStatus = status
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_');
  if (
    normalizedStatus === 'pending' ||
    normalizedStatus === 'todo' ||
    normalizedStatus === 'not_started'
  ) {
    return 'pending';
  }
  if (normalizedStatus === 'in_progress' || normalizedStatus === 'approved') {
    return 'in_progress';
  }
  if (normalizedStatus === 'auto_approved') return 'in_progress';
  if (isPlanTodoCompleted(normalizedStatus)) return 'completed';
  if (normalizedStatus === 'failed' || normalizedStatus === 'rejected') return 'failed';
  return null;
};

export const formatPlanStatusLabel = (status: string): string => {
  const normalizedStatus = status.trim().toLowerCase().replace(/[-_]+/g, ' ');
  if (isPlanTodoCompleted(normalizedStatus)) return 'Completed';
  if (!normalizedStatus || normalizedStatus === 'todo' || normalizedStatus === 'not started') {
    return 'Pending';
  }
  return normalizedStatus.replace(/\b\w/g, char => char.toUpperCase());
};

export const getPlanStatusTone = (statusLabel: string): FlowPlanStatusTone => {
  return normalizePlanStatusTone(statusLabel) ?? 'pending';
};

export const resolvePlanHeaderStatus = (
  props: Record<string, unknown>,
  completedCount: number,
  totalCount: number,
): PlanHeaderStatus => {
  const rejected = props['rejected'] === true;
  const superseded = props['superseded'] === true;
  if (rejected || superseded) {
    return { statusLabel: 'Rejected', statusTone: 'failed' };
  }

  const phase = getStringProp(props, 'phase').toLowerCase();
  if (phase === 'done') {
    return { statusLabel: 'Completed', statusTone: 'completed' };
  }
  if (phase === 'executing') {
    if (props['autoApproved'] === true) {
      return { statusLabel: 'Auto-approved', statusTone: 'in_progress' };
    }
    return { statusLabel: 'Approved', statusTone: 'in_progress' };
  }
  if (phase === 'proposed') {
    return { statusLabel: 'Pending', statusTone: 'pending' };
  }

  const status = getStringProp(props, 'status');
  if (status) {
    const normalized = status
      .trim()
      .toLowerCase()
      .replace(/[-\s]+/g, '_');
    if (normalized === 'approved') {
      return { statusLabel: 'Approved', statusTone: 'in_progress' };
    }
    if (normalized === 'auto_approved') {
      return { statusLabel: 'Auto-approved', statusTone: 'in_progress' };
    }
    if (normalized === 'rejected') {
      return { statusLabel: 'Rejected', statusTone: 'failed' };
    }
    const statusTone = normalizePlanStatusTone(status);
    if (statusTone === 'in_progress') {
      return { statusLabel: 'Approved', statusTone: 'in_progress' };
    }
    return {
      statusLabel: formatPlanStatusLabel(status),
      statusTone: statusTone ?? 'pending',
    };
  }

  if (totalCount > 0 && completedCount === totalCount) {
    return { statusLabel: 'Completed', statusTone: 'completed' };
  }

  return { statusLabel: 'Pending', statusTone: 'pending' };
};

export const getPlanTodoStatus = (todo: unknown): string => {
  if (!isRecord(todo)) return '';
  return typeof todo['status'] === 'string' ? todo['status'] : '';
};

export const isPlanTodoIncluded = (todo: unknown): boolean =>
  isRecord(todo) && todo['included'] === true;

export const normalizePlanTodoDisplayStatus = (
  todo: unknown,
  phase: string,
): PlanTodoDisplayStatus => {
  if (!isRecord(todo)) return 'queued';
  const status = getPlanTodoStatus(todo)
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_');
  if (isPlanTodoCompleted(status) || status === 'done') return 'done';
  if (status === 'running' || status === 'in_progress') return 'running';
  if (status === 'failed') return 'failed';
  if (phase === 'proposed' && isPlanTodoIncluded(todo)) return 'included';
  return 'queued';
};

export const resolvePlanTodoDisplayStatuses = (
  todos: PlanTodoViewModel[],
  statusTone: FlowPlanStatusTone,
): PlanTodoViewModel[] => {
  const allDone = todos.every(
    todo => todo.displayStatus === 'done' || todo.displayStatus === 'included',
  );
  if (statusTone !== 'in_progress' || allDone) return todos;

  const normalized = todos.map(todo => {
    if (todo.displayStatus === 'done' || todo.displayStatus === 'failed') return todo;
    return { ...todo, displayStatus: 'queued' as const };
  });

  const explicitRunningIndex = todos.findIndex(todo => todo.displayStatus === 'running');
  const activeIndex =
    explicitRunningIndex >= 0
      ? explicitRunningIndex
      : normalized.findIndex(
          todo => todo.displayStatus !== 'done' && todo.displayStatus !== 'failed',
        );

  if (activeIndex < 0) return normalized;

  const activeTodo = normalized[activeIndex];
  if (!activeTodo) return normalized;

  normalized[activeIndex] = { ...activeTodo, displayStatus: 'running' };
  return normalized;
};

export const countCompletedPlanTodos = (todos: unknown[]): number =>
  todos.filter(todo => isPlanTodoCompleted(getPlanTodoStatus(todo))).length;

export const findPlanComponent = (
  components: PlanComponentLike[] | undefined,
): PlanComponentLike | undefined => {
  if (!components) return undefined;
  for (const component of components) {
    if (component.type === 'plan') return component;
    const childPlan = findPlanComponent(component.children);
    if (childPlan) return childPlan;
  }
  return undefined;
};

export const buildPlanComponentViewModel = (
  props: Record<string, unknown>,
  normalizeText: PlanTextNormalizer,
): PlanComponentViewModel => {
  const titleRaw = getStringProp(props, 'title');
  const title = titleRaw ? normalizeText(titleRaw) : 'Plan';
  const descriptionRaw = getStringProp(props, 'desc') || getStringProp(props, 'description');
  const description = descriptionRaw ? normalizeText(descriptionRaw) : '';
  const todosRaw = Array.isArray(props['todos']) ? props['todos'] : [];
  const phase = getStringProp(props, 'phase').toLowerCase();
  const completedCount = countCompletedPlanTodos(todosRaw);
  const { statusLabel, statusTone } = resolvePlanHeaderStatus(
    props,
    completedCount,
    todosRaw.length,
  );

  const todos: PlanTodoViewModel[] = todosRaw.flatMap((todo, index) => {
    if (!isRecord(todo)) return [];
    const text = typeof todo['text'] === 'string' ? todo['text'].trim() : '';
    if (!text) return [];
    const id =
      typeof todo['id'] === 'string' && todo['id'].trim() ? todo['id'].trim() : `todo-${index}`;
    return [
      {
        id,
        text: normalizeText(text),
        displayStatus: normalizePlanTodoDisplayStatus(todo, phase),
      },
    ];
  });

  return {
    title,
    statusLabel,
    statusTone,
    description,
    completedCount,
    totalCount: todos.length,
    todos: resolvePlanTodoDisplayStatuses(todos, statusTone),
  };
};

export const createPlanComponentViewModel = (
  component: PlanComponentLike,
  normalizeText: PlanTextNormalizer,
): PlanComponentViewModel | null => {
  if (component.type !== 'plan') return null;
  const props = isRecord(component.props) ? component.props : undefined;
  if (!props) return null;
  return buildPlanComponentViewModel(props, normalizeText);
};

export const extractPlanMarkdownHeader = (markdown: string): FlowPlanMarkdownHeader | null => {
  const match = /^\s*\*\*([^*\n]+)\*\*\s+`\s*([^`\n]+?)\s*`\s*(?:\n+|$)([\s\S]*)$/m.exec(markdown);
  if (!match?.[1] || !match[2]) return null;

  const statusTone = normalizePlanStatusTone(match[2]);
  if (!statusTone) return null;

  return {
    title: match[1].trim(),
    statusLabel: formatPlanStatusLabel(match[2]),
    statusTone,
    restMarkdown: match[3] ?? '',
  };
};

export const extractPlanStatusToneFromMarkdown = (markdown: string): FlowPlanStatusTone | null => {
  const match = /^\s*\*\*[^*\n]+\*\*\s+`\s*([^`\n]+?)\s*`/m.exec(markdown);
  if (!match?.[1]) return null;
  return normalizePlanStatusTone(match[1]);
};
