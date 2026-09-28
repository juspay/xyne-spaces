import { z } from 'zod';

/**
 * Real records the assistant talks about: people, channels, threads. Only the backend's
 * resolvers create these, from names the user said; the language model never produces an id.
 *
 * Every record has the same base (kind, id, name). Adding a kind also needs changes to the
 * backend resolver and any operation or client code that consumes that record.
 */

export const ENTITY_KINDS = ['person', 'channel', 'thread'] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

interface EntityBase<K extends EntityKind> {
  kind: K;
  id: string;
  /** How the record is shown and spoken: a person's name, a channel's name, a thread's title. */
  name: string;
}

export type PersonRef = EntityBase<'person'>;

export interface ChannelRef extends EntityBase<'channel'> {
  /** A DM or group DM rather than a named channel. */
  isDirect?: boolean;
}

/** A thread: `id` is the thread's id and `name` its title. */
export interface ThreadRef extends EntityBase<'thread'> {
  channelId: string;
  channelName: string;
}

export type EntityRef = PersonRef | ChannelRef | ThreadRef;

export const personRefSchema = z
  .object({ kind: z.literal('person'), id: z.string().min(1), name: z.string() })
  .strict();

export const channelRefSchema = z
  .object({
    kind: z.literal('channel'),
    id: z.string().min(1),
    name: z.string(),
    isDirect: z.boolean().optional(),
  })
  .strict();

export const threadRefSchema = z
  .object({
    kind: z.literal('thread'),
    id: z.string().min(1),
    name: z.string(),
    channelId: z.string().min(1),
    channelName: z.string(),
  })
  .strict();

/** Checks a complete, supported record shape. */
export const entityRefSchema = z.discriminatedUnion('kind', [
  personRefSchema,
  channelRefSchema,
  threadRefSchema,
]) satisfies z.ZodType<EntityRef>;

/** A collected detail: text (or a choice id), one record, or several records. */
export type FieldValue = string | EntityRef | EntityRef[];

export function isEntityRef(value: unknown): value is EntityRef {
  return entityRefSchema.safeParse(value).success;
}

/** One choice offered to the user, shown as a button and answerable by voice. */
export interface ChoiceOption {
  id: string;
  label: string;
  /** Second line under the label, e.g. "#design · Priya". */
  detail?: string;
}

/** A record the user can pick when a spoken name matched several ("which Daniel?"). */
export interface Candidate extends ChoiceOption {
  value: FieldValue;
}
