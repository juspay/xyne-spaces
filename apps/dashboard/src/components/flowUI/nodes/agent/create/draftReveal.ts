/**
 * Paces a streamed draft turn onto the create canvas: one part at a time, top to
 * bottom, each given time to land before the next starts. Name, handle and
 * description type in, then each tools row with its pills, the schedule, each
 * property, and last the instructions.
 *
 * Only the reveal is paced, never the stream: parts that arrive early wait their
 * turn, and a part that is slow to arrive (usually the tool plan) is passed over
 * after a short wait and shown the moment it lands.
 */
import type { DraftField, DraftMode } from './agentDraftStream';
import type { HubPlanField } from './hubPlan';
import type {
  AgentCreateChatPatch,
  AgentCreateField,
  AgentCreateFormState,
  AgentCreateHubRow,
  CreateHubSuggestions,
} from './types';

export type RevealSlot = 'identity' | 'capabilities' | 'schedule' | 'properties' | 'instructions';

/** Canvas order, top to bottom. */
export const REVEAL_ORDER: readonly RevealSlot[] = [
  'identity',
  'capabilities',
  'schedule',
  'properties',
  'instructions',
];

/**
 * Longest the walk waits for an expected part. The tool plan is the one that
 * lags; the server starts the instructions at most 2s after the rest, and the
 * first instructions text also ends the wait.
 */
export const REVEAL_WAIT_MS = 3_000;

/** Pauses between parts, long enough for each entrance to read as its own. */
export const REVEAL_HOLD_MS = {
  field: 120,
  row: 140,
  pill: 50,
  rowMax: 480,
  property: 120,
} as const;

/** Longest a name or description takes to type in. */
export const TYPE_MS = { name: 260, description: 480 } as const;

/** Parts a turn will write, from its `mode` event. */
export function expectedSlots(mode: DraftMode, fields: readonly DraftField[]): Set<RevealSlot> {
  const has = (field: DraftField): boolean => fields.includes(field);
  const slots = new Set<RevealSlot>();
  if (has('name') || has('handle') || has('description')) slots.add('identity');
  if (mode === 'draft' || has('tools') || has('skills') || has('knowledge')) {
    slots.add('capabilities');
  }
  if (has('schedule')) slots.add('schedule');
  if (has('properties')) slots.add('properties');
  if (has('instructions')) slots.add('instructions');
  return slots;
}

export interface DraftReveal {
  /** Start walking the canvas, waiting for these parts. */
  start: (expected: ReadonlySet<RevealSlot>) => void;
  /** Hand over a part. It runs when the walk reaches it, or at once if the walk has passed it. */
  fill: (slot: RevealSlot, run: () => Promise<void>) => void;
  /** The stream ended: stop waiting. Resolves once every part handed over has run. */
  finish: () => Promise<void>;
}

export function createDraftReveal({
  signal,
  waitMs = REVEAL_WAIT_MS,
}: {
  signal: AbortSignal;
  waitMs?: number;
}): DraftReveal {
  const pending = new Map<RevealSlot, Array<() => Promise<void>>>();
  const passed = new Set<RevealSlot>();
  const wakers = new Set<() => void>();
  let ended = false;
  let walk: Promise<void> | null = null;
  /** Parts that land after the walk passed them run beside it, not behind it. */
  let late: Promise<void> = Promise.resolve();
  let firstError: Error | null = null;

  const runStep = async (step: () => Promise<void>): Promise<void> => {
    if (signal.aborted) return;
    try {
      await step();
    } catch (err) {
      firstError ??= err instanceof Error ? err : new Error(String(err));
    }
  };
  const wakeAll = (): void => {
    for (const wake of [...wakers]) wake();
  };
  signal.addEventListener('abort', wakeAll, { once: true });

  /** Until `slot` (or the instructions, the last thing sent) arrives, the stream ends, or time's up. */
  const waitFor = (slot: RevealSlot): Promise<void> =>
    new Promise(resolve => {
      const ready = (): boolean =>
        ended || signal.aborted || pending.has(slot) || pending.has('instructions');
      if (ready()) {
        resolve();
        return;
      }
      const done = (): void => {
        clearTimeout(timer);
        wakers.delete(check);
        resolve();
      };
      const check = (): void => {
        if (ready()) done();
      };
      const timer = setTimeout(done, waitMs);
      wakers.add(check);
    });

  const walkFrom = async (expected: ReadonlySet<RevealSlot>): Promise<void> => {
    for (const slot of REVEAL_ORDER) {
      if (signal.aborted) return;
      if (expected.has(slot)) await waitFor(slot);
      passed.add(slot);
      const steps = pending.get(slot) ?? [];
      pending.delete(slot);
      for (const step of steps) await runStep(step);
    }
  };

  return {
    start: (expected): void => {
      walk ??= walkFrom(expected);
    },
    fill: (slot, run): void => {
      if (passed.has(slot)) {
        late = late.then(() => runStep(run));
        return;
      }
      pending.set(slot, [...(pending.get(slot) ?? []), run]);
      wakeAll();
    },
    finish: async (): Promise<void> => {
      ended = true;
      wakeAll();
      // A turn that never said what it writes still shows what it sent, in order.
      walk ??= walkFrom(new Set());
      await walk;
      await late;
      if (firstError) throw firstError;
    },
  };
}

// ---------------------------------------------------------------------------
// Tools rows, one at a time
// ---------------------------------------------------------------------------

/** Tools rows in canvas order. */
export const HUB_REVEAL_ORDER: readonly AgentCreateHubRow[] = [
  'mcp',
  'subagent',
  'builtin',
  'skills',
  'knowledge',
];

const PLAN_FIELD: Record<AgentCreateHubRow, HubPlanField> = {
  mcp: 'tools',
  subagent: 'tools',
  builtin: 'tools',
  skills: 'skills',
  knowledge: 'knowledge',
};

/** The canvas field a row belongs to, for the shimmer and progress label. */
export function canvasFieldForRow(row: AgentCreateHubRow): AgentCreateField {
  return PLAN_FIELD[row];
}

/** Suggested chips the plan has for `row`, when the plan decides that row. */
export function rowSuggestionCount(
  row: AgentCreateHubRow,
  suggestions: CreateHubSuggestions,
  hubs: readonly HubPlanField[],
): number {
  if (!hubs.includes(PLAN_FIELD[row])) return 0;
  switch (row) {
    case 'mcp':
      return suggestions.mcp.length;
    case 'subagent':
      return suggestions.subagents.length;
    case 'builtin':
      return suggestions.builtin.length;
    case 'skills':
      return suggestions.skills.length;
    case 'knowledge':
      return suggestions.knowledge.length;
  }
}

/**
 * The part of a plan patch that belongs to one row, laid over the live form so
 * rows already revealed keep what they show. Empty when the row doesn't change.
 */
export function rowPatch(
  row: AgentCreateHubRow,
  patch: AgentCreateChatPatch,
  form: AgentCreateFormState,
): AgentCreateChatPatch {
  const tools = patch.tools;
  switch (row) {
    case 'mcp':
      if (!tools || (tools.gateway === form.tools.gateway && tools.direct === form.tools.direct)) {
        return {};
      }
      return { tools: { ...form.tools, gateway: tools.gateway, direct: tools.direct } };
    case 'subagent':
      if (
        !tools ||
        (tools.subagents === form.tools.subagents &&
          tools.callableAgents === form.tools.callableAgents)
      ) {
        return {};
      }
      return {
        tools: { ...form.tools, subagents: tools.subagents, callableAgents: tools.callableAgents },
      };
    case 'builtin':
      if (!tools || tools.custom === form.tools.custom) return {};
      return { tools: { ...form.tools, custom: tools.custom } };
    case 'skills':
      return patch.selectedSkillIds && patch.selectedSkillIds !== form.selectedSkillIds
        ? { selectedSkillIds: patch.selectedSkillIds }
        : {};
    case 'knowledge': {
      const next: AgentCreateChatPatch = {};
      if (patch.selectedKbScope && patch.selectedKbScope !== form.selectedKbScope) {
        next.selectedKbScope = patch.selectedKbScope;
      }
      if (patch.selectedKbResources && patch.selectedKbResources !== form.selectedKbResources) {
        next.selectedKbResources = patch.selectedKbResources;
      }
      return next;
    }
  }
}

/** Suggested (dashed) chips with only `row`'s replaced, when the plan decides that row. */
export function rowSuggestions(
  prev: CreateHubSuggestions,
  next: CreateHubSuggestions,
  hubs: readonly HubPlanField[],
  row: AgentCreateHubRow,
): CreateHubSuggestions {
  if (!hubs.includes(PLAN_FIELD[row])) return prev;
  switch (row) {
    case 'mcp':
      return prev.mcp === next.mcp ? prev : { ...prev, mcp: next.mcp };
    case 'subagent':
      return prev.subagents === next.subagents ? prev : { ...prev, subagents: next.subagents };
    case 'builtin':
      return prev.builtin === next.builtin ? prev : { ...prev, builtin: next.builtin };
    case 'skills':
      return prev.skills === next.skills ? prev : { ...prev, skills: next.skills };
    case 'knowledge':
      return prev.knowledge === next.knowledge ? prev : { ...prev, knowledge: next.knowledge };
  }
}

/**
 * Roughly how many pills a row ends up with, so its pause fits them. Tool lists
 * can hold several tools per pill; the pause is capped, so an overcount only
 * reaches the cap.
 */
export function rowPillCount(
  row: AgentCreateHubRow,
  form: AgentCreateFormState,
  suggestions: CreateHubSuggestions,
): number {
  switch (row) {
    case 'mcp':
      return form.tools.gateway.length + form.tools.direct.length + suggestions.mcp.length;
    case 'subagent':
      return form.tools.subagents.length + suggestions.subagents.length;
    case 'builtin':
      return form.tools.custom.length + suggestions.builtin.length;
    case 'skills':
      return form.selectedSkillIds.length + suggestions.skills.length;
    case 'knowledge':
      return form.selectedKbResources.length + suggestions.knowledge.length;
  }
}

/** Pause after a row lands: the row, then its pills one step apart. */
export function rowHoldMs(pills: number): number {
  return Math.min(REVEAL_HOLD_MS.rowMax, REVEAL_HOLD_MS.row + pills * REVEAL_HOLD_MS.pill);
}

// ---------------------------------------------------------------------------
// Typing text in
// ---------------------------------------------------------------------------

export const nextFrame = (): Promise<void> =>
  new Promise(resolve => window.requestAnimationFrame(() => resolve()));

/**
 * Prefix lengths to show, one per frame, so `length` characters type in within
 * about `maxMs` (never slower than a few characters a frame).
 */
export function typingSteps(length: number, maxMs: number, frameMs = 16): number[] {
  if (length <= 0) return [];
  const frames = Math.max(1, Math.round(maxMs / frameMs));
  const perFrame = Math.max(2, Math.ceil(length / frames));
  const steps: number[] = [];
  for (let shown = perFrame; shown < length; shown += perFrame) steps.push(shown);
  steps.push(length);
  return steps;
}

/**
 * How many more characters of streamed text to show this frame: enough to catch
 * up on a backlog within about half a second, and at least a few so it reads as
 * writing rather than a stall.
 */
export function catchUpStep(backlog: number): number {
  if (backlog <= 0) return 0;
  return Math.min(backlog, Math.max(3, Math.ceil(backlog / 30)));
}
