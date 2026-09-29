import { z } from 'zod';
import {
  channelRefSchema,
  entityRefSchema,
  messageRefSchema,
  personRefSchema,
  threadRefSchema,
  type EntityKind,
} from './references.js';

/**
 * The fixed set of things the assistant can actually do in the app. Actions combine these in
 * their `plan`; the backend fills in the values; the dashboard runs the whole plan with the
 * user's own session and reports the results back once.
 *
 * This file is the only place an operation is defined. Add one only when an action needs
 * something none of these can express, and teach the dashboard's runner to perform it.
 */

/** A reference to a channel or thread found by the backend, or a channel made by an earlier step. */
const fromStep = z.object({ fromStep: z.number().int().min(0) }).strict();
const conversation = z.union([channelRefSchema, threadRefSchema, fromStep]);

const openOrCreateDm = z
  .object({ op: z.literal('open_or_create_dm'), user: personRefSchema })
  .strict()
  .describe('Finds the DM with this person, or creates it; reopens it if it was closed.');

const createChannel = z
  .object({
    op: z.literal('create_channel'),
    name: z.string().trim().min(2).max(80),
    visibility: z.enum(['public', 'private']),
    members: z.array(personRefSchema),
  })
  .strict();

const sendMessage = z
  .object({
    op: z.literal('send_message'),
    target: conversation,
    text: z.string().min(1),
    /** People or agents to @mention in the message. */
    mentions: z.array(personRefSchema).optional(),
  })
  .strict()
  .describe('A new message in a channel or DM, or a reply in a thread.');

const forwardMessage = z
  .object({
    op: z.literal('forward_message'),
    message: messageRefSchema,
    target: z.union([channelRefSchema, fromStep]),
  })
  .strict()
  .describe('Forwards a message that already exists into a channel or DM.');

const navigate = z
  .object({ op: z.literal('navigate'), target: conversation })
  .strict()
  .describe('Opens a conversation, so the user sees where the action happened.');

export const operationSchema = z.discriminatedUnion('op', [
  openOrCreateDm,
  createChannel,
  sendMessage,
  forwardMessage,
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

/** Required parameter names, derived from the operation schemas. */
export const OPERATION_REQUIRED_PARAMS: ReadonlyMap<OperationName, ReadonlySet<string>> = new Map(
  operationSchema.options.map(option => [
    option.shape.op.value,
    new Set(
      Object.entries(option.shape)
        .filter(([key, schema]) => key !== 'op' && !schema.isOptional())
        .map(([key]) => key),
    ),
  ]),
);

/** One operation outcome returned by the dashboard. */
export const operationResultSchema = z
  .object({
    ok: z.boolean(),
    produced: entityRefSchema.optional(),
    error: z.string().max(500).optional(),
  })
  .strict();

export type OperationResult = z.infer<typeof operationResultSchema>;

/** Operations in order; a later step may use what an earlier step produced. */
export type Plan = Operation[];
