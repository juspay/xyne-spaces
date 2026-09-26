import { z } from 'zod';
import type { EntityKind, EntityRef } from './references.js';

/**
 * The fixed set of things the assistant can actually do in the app. Actions combine these in
 * their `plan`; the backend fills in the values; the dashboard runs the whole plan with the
 * user's own session and reports the results back once.
 *
 * This file is the only place an operation is defined. Add one only when an action needs
 * something none of these can express, and teach the dashboard's runner to perform it.
 */

const personRef = z
  .object({ kind: z.literal('person'), id: z.string().min(1), name: z.string() })
  .strict();

/** A conversation to act in: a known one, or the one an earlier step produced. */
const conversation = z.union([
  z.object({ channelId: z.string().min(1) }).strict(),
  z.object({ fromStep: z.number().int().min(0) }).strict(),
]);

const openOrCreateDm = z
  .object({ op: z.literal('open_or_create_dm'), user: personRef })
  .strict()
  .describe('Finds the DM with this person, or creates it; reopens it if it was closed.');

const createChannel = z
  .object({
    op: z.literal('create_channel'),
    name: z.string().trim().min(2).max(80),
    visibility: z.enum(['public', 'private']),
    members: z.array(personRef),
  })
  .strict();

const sendMessage = z
  .object({ op: z.literal('send_message'), target: conversation, text: z.string().min(1) })
  .strict()
  .describe('A new top-level message in a channel or DM.');

const navigate = z
  .object({ op: z.literal('navigate'), target: conversation })
  .strict()
  .describe('Opens a conversation, so the user sees where the action happened.');

export const operationSchema = z.discriminatedUnion('op', [
  openOrCreateDm,
  createChannel,
  sendMessage,
  navigate,
]);

export type Operation = z.infer<typeof operationSchema>;
export type OperationName = Operation['op'];

/** What each operation produces, for later steps that say `{ fromStep: n }`. */
export const OPERATION_PRODUCES: ReadonlyMap<OperationName, EntityKind> = new Map([
  ['open_or_create_dm', 'channel'],
  ['create_channel', 'channel'],
]);

/** Parameter names each operation accepts, for checking action plans when they load. */
export const OPERATION_PARAMS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  operationSchema.options.map(option => [
    option.shape.op.value,
    new Set(Object.keys(option.shape).filter(key => key !== 'op')),
  ]),
);

/** The outcome of one operation, reported by the dashboard's runner. */
export interface OperationResult {
  ok: boolean;
  /** The record the operation created or opened, for later steps and the final reply. */
  produced?: EntityRef;
  error?: string;
}

/** Operations in order; a later step may use what an earlier step produced. */
export type Plan = Operation[];
