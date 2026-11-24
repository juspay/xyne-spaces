import {
  RESTING,
  nextAgentState,
  withParked,
  withoutParked,
  type BubbleAgentState,
  type ParkedThread,
  type WorkingAgents,
} from './bubbles';

/** The toast an answer drops: once, for the thread whose agent just finished. */
export type BubbleToast = Readonly<{
  threadId: string;
  title: string;
  agentIds: readonly string[];
  agentName: string | null;
}>;

export type BubbleState = Readonly<{
  /** Whose threads these are (workspace and user), so a switch never shows another's. */
  scope: string | null;
  /** Newest first. */
  parked: readonly ParkedThread[];
  agents: Readonly<Record<string, BubbleAgentState>>;
  toast: BubbleToast | null;
}>;

const EMPTY: BubbleState = { scope: null, parked: [], agents: {}, toast: null };

/**
 * Parked threads, in memory for the app session: a plain module store like
 * `hold-source-store.ts` (the app persists no comparable UI state), read with
 * `useSyncExternalStore`. The thread header parks, the bubbles read, and each
 * bubble's agent feed reports in.
 */
let state: BubbleState = EMPTY;
const listeners = new Set<() => void>();

function commit(next: BubbleState): void {
  if (next === state) return;
  state = next;
  listeners.forEach(listener => listener());
}

export function subscribeBubbles(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

export function getBubbles(): BubbleState {
  return state;
}

/** What `scope` may see: nothing when the threads were parked by another workspace or user. */
export function bubblesFor(current: BubbleState, scope: string | null): BubbleState {
  return scope !== null && current.scope === scope ? current : EMPTY;
}

/** Parks a thread in front; a new scope starts a fresh stack. */
export function parkThread(scope: string, thread: ParkedThread): void {
  const base = state.scope === scope ? state : { ...EMPTY, scope };
  commit({ ...base, parked: withParked(base.parked, thread) });
}

/** Lets one thread go (its ×, or opening it), with its agent state and toast. */
export function unparkThread(threadId: string): void {
  if (!state.parked.some(entry => entry.threadId === threadId)) return;
  const agents = Object.fromEntries(Object.entries(state.agents).filter(([id]) => id !== threadId));
  commit({
    ...state,
    parked: withoutParked(state.parked, threadId),
    agents,
    toast: state.toast?.threadId === threadId ? null : state.toast,
  });
}

/** Puts every parked thread down. */
export function clearParked(): void {
  if (state.parked.length === 0) return;
  commit({ ...EMPTY, scope: state.scope });
}

/** A parked thread's agent feed changed: `null` means none is running. */
export function reportBubbleAgents(threadId: string, working: WorkingAgents | null): void {
  const thread = state.parked.find(entry => entry.threadId === threadId);
  if (!thread) return;
  const previous = state.agents[threadId] ?? RESTING;
  const { state: next, answeredNow } = nextAgentState(previous, working);
  if (next === previous) return;
  commit({
    ...state,
    agents: { ...state.agents, [threadId]: next },
    toast:
      answeredNow && next.kind === 'answered'
        ? { threadId, title: thread.title, agentIds: next.agentIds, agentName: next.agentName }
        : state.toast,
  });
}

export function dismissBubbleToast(threadId: string): void {
  if (state.toast?.threadId !== threadId) return;
  commit({ ...state, toast: null });
}

/** Test-only. */
export function resetBubblesForTests(): void {
  state = EMPTY;
}
