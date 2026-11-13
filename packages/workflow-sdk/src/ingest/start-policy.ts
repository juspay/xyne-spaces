/**
 * When a run becomes eligible — the trigger binding's answer to "start now, or later?".
 *
 * A delayed start is a property of the BINDING, not a step: "escalate two hours
 * after the ticket was created" says when the workflow starts, not what it does.
 * Keeping it here means the run is armed at arrival and admitted when it fires, so
 * the conditions that decide whether it acts are judged against the world as it is
 * THEN — which is the entire point of waiting.
 *
 * Two constructors rather than one anchor field, deliberately: `delay` is anchored
 * on the event, which already knows when it happened, so it needs no read; `at` is
 * anchored on a date carried by the enriched payload, so it does. The difference is
 * visible in the type, and {@link startNeedsPayload} lets the runtime branch on it
 * before deciding whether to enrich anything.
 */

import { z } from 'zod';
import { resolveValue } from '../engine/resolve-expressions.js';
import { extractRefPath, isPureRef } from '../util/variable-ref.js';
import { isExpression } from '../expression/format.js';
import { projectVariables } from '../types/workflow-variable.js';
import type { WorkflowContext } from '../types/context.js';
import type { WorkflowConfig } from '../types/workflow-config.js';
import type { TriggerEvent } from './types.js';


// ─── Policy ───

export interface Duration {
  readonly amount: number;
  readonly unit: 'minutes' | 'hours' | 'days';
}

/**
 * An offset that can fall on either side of its anchor.
 *
 * "One day before the due date" is as ordinary a rule as "thirty minutes after
 * the ETA", and a negative amount in a field labelled *hours* reads badly in a
 * form — so the side is its own word.
 */
export interface SignedOffset extends Duration {
  readonly direction: 'before' | 'after';
}

export type TriggerStart =
  /** Admit the event as it arrives. The default when a binding says nothing. */
  | { readonly kind: 'immediate' }
  /** Wait `offset` from the event itself — no enrichment needed to know when. */
  | { readonly kind: 'delay'; readonly offset: Duration }
  /**
   * Wait for a moment in time, optionally offset to either side of it.
   *
   * The anchor is a DATETIME FIELD in the same sense as any other config value
   * that accepts a reference: either a literal ISO timestamp, or `{{...}}`
   * reading a datetime the trigger produces (`{{trigger.ticket.eta}}`) or a
   * workflow variable. Typing it this way rather than as a bare payload path is
   * what lets the builder offer the trigger's own fields in its picker, and lets
   * the validator reject an anchor that does not exist or is not a time — a bare
   * path fails silently instead: rename the field and every rule that used it
   * quietly stops arming.
   *
   * `ifPast` decides what a time already behind us means: run straight away, or
   * let it go.
   */
  | {
      readonly kind: 'at';
      readonly anchor: string;
      readonly offset?: SignedOffset;
      readonly ifPast: 'run' | 'skip';
    };

/**
 * How far ahead a run may be armed. A typo in a date field ("2035") should not
 * park a timer for a decade, and the queue backing the delay has its own limits.
 */
export const MAX_START_DELAY_MS = 30 * 24 * 60 * 60 * 1000;

const MS_PER_UNIT: Record<Duration['unit'], number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

export function durationMs(offset: Duration): number {
  return offset.amount * MS_PER_UNIT[offset.unit];
}

const DurationShape = {
  amount: z.number().int().positive(),
  unit: z.enum(['minutes', 'hours', 'days']),
};

const withinCap = {
  check: (d: Duration) => durationMs(d) <= MAX_START_DELAY_MS,
  message: 'A start delay may be at most 30 days',
};

const DurationSchema = z.object(DurationShape).strict().refine(withinCap.check, {
  message: withinCap.message,
});

const SignedOffsetSchema = z
  .object({ ...DurationShape, direction: z.enum(['before', 'after']) })
  .strict()
  .refine(withinCap.check, { message: withinCap.message });

/**
 * What an anchor has to resolve to. Exported so the config validator can hold a
 * reference to the same contract the runtime reads: anchor on a title and the
 * workflow does not save, rather than arming nothing at runtime.
 */
export const AnchorValueSchema = z.string().datetime({ offset: true });

/**
 * A datetime field that also takes a reference — the same shape as any other
 * config value authors can point at data, so the builder's variable picker and
 * its type filter work on it unchanged.
 *
 * A reference may read only the trigger's output or a workflow variable: those
 * are the only two things that exist before a run — a rule the config validator
 * extends to every reference inside an expression.
 */
const AnchorSchema = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    if (isPureRef(value)) {
      const head = anchorSource(value).split('.')[0];
      if (head !== 'trigger' && head !== 'vars') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'An anchor can only read trigger data or a workflow variable',
        });
      }
      return;
    }
    // Worked out rather than read — a date assembled from what the event
    // carried. Accepted on shape alone: reading what is *inside* it needs the
    // expression parser, and the config validator is where that lives, so this
    // schema stays free of it and of the engine it would drag along.
    if (isExpression(value)) return;
    if (!AnchorValueSchema.safeParse(value).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'An anchor must be a date and time, or a reference to one such as {{trigger.ticket.eta}}',
      });
    }
  });

export const TriggerStartSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('immediate') }).strict(),
  z.object({ kind: z.literal('delay'), offset: DurationSchema }).strict(),
  z
    .object({
      kind: z.literal('at'),
      anchor: AnchorSchema,
      offset: SignedOffsetSchema.optional(),
      ifPast: z.enum(['run', 'skip']),
    })
    .strict(),
]);

/** The dotted path inside an anchor reference, for display and validation. */
export function anchorSource(anchor: string): string {
  return extractRefPath(anchor) ?? anchor;
}

// ─── Decision ───

/** Where a fire time came from, so a scheduled run can explain itself. */
export interface StartAnchor {
  /** `event` for the event's own clock, otherwise the payload path that was read. */
  readonly source: string;
  readonly value: string;
}

export type StartDecision =
  | { readonly kind: 'now' }
  | { readonly kind: 'at'; readonly at: Date; readonly anchor: StartAnchor }
  | {
      readonly kind: 'skip';
      readonly reason: 'anchor-missing' | 'anchor-unreadable' | 'anchor-past' | 'anchor-too-far';
    };

/**
 * Does working out the fire time need the enriched payload?
 *
 * Only when the anchor reads the trigger. A literal timestamp, or an anchor on a
 * workflow variable, is a constant the author set — it costs no read at all.
 */
export function startNeedsPayload(start: TriggerStart | undefined): boolean {
  return start?.kind === 'at' && anchorSource(start.anchor).split('.')[0] === 'trigger';
}

/** Is this binding delayed at all? */
export function isDelayedStart(start: TriggerStart | undefined): boolean {
  return start !== undefined && start.kind !== 'immediate';
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * When should this event's run become eligible?
 *
 * `anchorValue` is whatever the policy's anchor reference resolved to, which the
 * runtime reads for `at` policies and leaves undefined for the rest. Nothing it
 * read is retained: a delayed run is armed from the raw event and enriched again
 * when it fires, and that second reading is the one the run acts on.
 */
export function resolveStartAt(
  start: TriggerStart | undefined,
  event: TriggerEvent,
  anchorValue: unknown,
  now: Date,
): StartDecision {
  if (!start || start.kind === 'immediate') return { kind: 'now' };

  if (start.kind === 'delay') {
    // An event with no clock of its own is treated as having just happened —
    // "two hours after the event" then means two hours from arrival.
    const occurred = toDate(event.occurredAt) ?? now;
    const at = new Date(occurred.getTime() + durationMs(start.offset));
    if (at.getTime() <= now.getTime()) return { kind: 'now' };
    if (at.getTime() - now.getTime() > MAX_START_DELAY_MS) {
      return { kind: 'skip', reason: 'anchor-too-far' };
    }
    return {
      kind: 'at',
      at,
      anchor: { source: 'event', value: occurred.toISOString() },
    };
  }

  if (anchorValue === undefined || anchorValue === null) {
    return { kind: 'skip', reason: 'anchor-missing' };
  }
  const anchorDate = toDate(anchorValue);
  if (!anchorDate) return { kind: 'skip', reason: 'anchor-unreadable' };

  const shift = start.offset
    ? durationMs(start.offset) * (start.offset.direction === 'before' ? -1 : 1)
    : 0;
  const at = new Date(anchorDate.getTime() + shift);
  if (at.getTime() <= now.getTime()) {
    return start.ifPast === 'run' ? { kind: 'now' } : { kind: 'skip', reason: 'anchor-past' };
  }
  if (at.getTime() - now.getTime() > MAX_START_DELAY_MS) {
    return { kind: 'skip', reason: 'anchor-too-far' };
  }
  return {
    kind: 'at',
    at,
    anchor: { source: anchorSource(start.anchor), value: anchorDate.toISOString() },
  };
}

/**
 * Read an anchor against the only context that exists before a run: the trigger's
 * payload and the workflow's author-time variables. Mirrors how a trigger filter
 * is evaluated, so both read the same world.
 */
export async function readAnchor(
  anchor: string,
  payload: Readonly<Record<string, unknown>>,
  variables: WorkflowConfig['variables'],
): Promise<unknown> {
  const context = {
    workflow: { id: '', metadata: {} },
    trigger: payload,
    steps: {},
    vars: projectVariables(variables),
  } as unknown as WorkflowContext;
  return resolveValue(anchor, context);
}

/** Why a delayed start produced no run, in words a run list can show. */
export function startSkipReason(reason: Extract<StartDecision, { kind: 'skip' }>['reason']): string {
  switch (reason) {
    case 'anchor-missing':
      return 'the date this run waits for is not set';
    case 'anchor-unreadable':
      return 'the date this run waits for could not be read';
    case 'anchor-past':
      return 'that date has already passed';
    case 'anchor-too-far':
      return 'that date is more than 30 days away';
  }
}
