import { z } from 'zod';

/**
 * Server-side facts the encryption service (or the backend, for plaintext) can derive from an
 * encrypted field's plaintext. One name = one fact = one value; a contract lists the names it
 * reads under each source field, nothing nested.
 */
export const EXTRACTORS = [
  'userIds',
  'groupIds',
  'handles',
  'mentionsChannel',
  'mentionsHere',
  'allUrls',
  'firstUrl',
  'prLinks',
  'meetLinks',
  'isBotCommand',
  'commandName',
  'commandArgs',
  'textLength',
  'textIsEmpty',
  'flowJsonPresent',
  'forwardedMessageId',
  'forwardedConversationId',
  'forwardedChannelId',
  'forwardedSenderId',
  'fileExtension',
  'isHeic',
] as const;
export type ExtractorName = (typeof EXTRACTORS)[number];

/**
 * What each fact is. The extractor functions in encryption-transformation/ are typed against
 * this, so a contract that lists `userIds` is promising exactly `string[]` to its handler,
 * whoever runs the extractor.
 */
export interface ExtractorOutput {
  /** Users mentioned directly: `<userid:…>` tokens and `data-user-id` spans. */
  userIds: string[];
  /** User groups mentioned: `<groupid:…>` tokens and `data-group-id` spans. */
  groupIds: string[];
  /** Zero-width-space `@name` handles the backend resolves to users and group aliases. */
  handles: string[];
  /** The message addresses `@channel`. */
  mentionsChannel: boolean;
  /** The message addresses `@here`. */
  mentionsHere: boolean;
  /** Every URL in the text, in order, deduplicated. */
  allUrls: string[];
  /** The first URL, for the link preview; null when there is none. */
  firstUrl: string | null;
  /** URLs of pull requests. */
  prLinks: string[];
  /** Google Meet URLs. */
  meetLinks: string[];
  /** The text starts with `/`: a bot command. */
  isBotCommand: boolean;
  /** The command's bot name (`/<name> …`); null when the text is not a parseable command. */
  commandName: string | null;
  /** The command's parameter string after the name; null when not a parseable command. */
  commandArgs: string | null;
  /** Visible length, the same rule the composer and the message repository limit apply. */
  textLength: number;
  /** The text is blank once trimmed. */
  textIsEmpty: boolean;
  /** The message carries FlowJSON (a card, a plan, a slash-command artifact). */
  flowJsonPresent: boolean;
  /** Forwarded message: the original message id; null when the content is not a forward. */
  forwardedMessageId: string | null;
  /** Forwarded message: the original conversation id; null when not a forward. */
  forwardedConversationId: string | null;
  /** Forwarded message: the original channel id; null when not a forward or it had none. */
  forwardedChannelId: string | null;
  /** Forwarded message: the original sender id; null when not a forward. */
  forwardedSenderId: string | null;
  /** File name source: the lowercase extension without the dot; null when there is none. */
  fileExtension: string | null;
  /** File name source: a HEIC/HEIF image by its extension. */
  isHeic: boolean;
}

/**
 * The parsers the facts are computed from, each run once per text: the mention tokens, the
 * URLs, the slash command, the visible text. Internal to encryption-transformation/.
 */
export interface ExtractorGroups {
  mentions: { userIds: string[]; groupIds: string[]; handles: string[]; channel: boolean; here: boolean };
  links: { all: string[]; first: string | null; pr: string[]; meet: string[] };
  command: { isBot: boolean; name: string | null; args: string | null } | null;
  text: { length: number; isEmpty: boolean };
  forwarded: { messageId: string | null; conversationId: string | null; channelId: string | null; senderId: string | null };
}

/** A typed handle on one fact, for a contract's `sourceToDerived`: `derive.userIds`. */
export interface Derivable<N extends ExtractorName = ExtractorName> {
  readonly name: N;
}

/** `derive.userIds`, `derive.meetLinks`, …: one handle per fact in `EXTRACTORS`. */
export const derive: { readonly [N in ExtractorName]: Derivable<N> } = Object.fromEntries(
  EXTRACTORS.map(name => [name, { name }]),
) as { readonly [N in ExtractorName]: Derivable<N> };

/** The facts for ONE field's plaintext: the names its contract listed, each with its value. */
export type FieldFacts = { [N in ExtractorName]?: ExtractorOutput[N] };

/**
 * The facts for a request: per source field, the facts its contract lists. Keyed by field, so
 * a handler reads `derived.fields.content.userIds` and facts of different fields are never
 * merged. A field is absent when it carried no text (empty, null, not sent).
 */
export type DerivedFacts = { version: 2; fields: Record<string, FieldFacts> };

/**
 * Runtime shape check only: every fact optional, since a contract lists a subset. The strict
 * per-contract type (`RequestDerived`) is what handlers are checked against.
 */
export const fieldFactsSchema: z.ZodType<FieldFacts> = z.object({
  userIds: z.array(z.string()).optional(),
  groupIds: z.array(z.string()).optional(),
  handles: z.array(z.string()).optional(),
  mentionsChannel: z.boolean().optional(),
  mentionsHere: z.boolean().optional(),
  allUrls: z.array(z.string()).optional(),
  firstUrl: z.string().nullable().optional(),
  prLinks: z.array(z.string()).optional(),
  meetLinks: z.array(z.string()).optional(),
  isBotCommand: z.boolean().optional(),
  commandName: z.string().nullable().optional(),
  commandArgs: z.string().nullable().optional(),
  textLength: z.number().int().nonnegative().optional(),
  textIsEmpty: z.boolean().optional(),
  flowJsonPresent: z.boolean().optional(),
  forwardedMessageId: z.string().nullable().optional(),
  forwardedConversationId: z.string().nullable().optional(),
  forwardedChannelId: z.string().nullable().optional(),
  forwardedSenderId: z.string().nullable().optional(),
  fileExtension: z.string().nullable().optional(),
  isHeic: z.boolean().optional(),
});

export const derivedFactsSchema: z.ZodType<DerivedFacts> = z.object({
  version: z.literal(2),
  fields: z.record(z.string(), fieldFactsSchema),
});
