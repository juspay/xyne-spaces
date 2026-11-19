import { z } from 'zod';

/** Server-side facts the encryption service can derive from an encrypted field's plaintext. */
export const EXTRACTORS = ['mentions', 'links', 'command', 'text'] as const;
export type ExtractorName = (typeof EXTRACTORS)[number];

/**
 * What each extractor returns. The extractor functions in encryption-transformation/ are
 * typed against this, so a contract that picks keys of `mentions` is promising exactly those
 * keys, with these types, to its handler, whoever runs the extractor (the encryption service
 * or the backend).
 */
export interface ExtractorOutput {
  mentions: { userIds: string[]; groupIds: string[]; handles: string[]; channel: boolean; here: boolean };
  links: { all: string[]; first: string | null; pr: string[]; meet: string[] };
  command: { isBot: boolean; name: string | null; args: string | null } | null;
  text: { length: number; isEmpty: boolean };
}

/** The keys of one extractor's output (ignoring a `null` result). */
export type OutputKey<N extends ExtractorName> = Extract<keyof NonNullable<ExtractorOutput[N]>, string>;

/** One extractor, as named in a contract: `derive.mentions`. Only `pick` turns it into something a contract accepts. */
export interface Extractor<N extends ExtractorName = ExtractorName> {
  readonly name: N;
}

/**
 * One extractor with the output keys a contract selected: what `sourceToDerived` lists under a
 * source field. Made with `pick(derive.mentions, 'userIds', 'groupIds')`, never by hand.
 */
export interface Derivable<N extends ExtractorName = ExtractorName, K extends OutputKey<N> = OutputKey<N>> {
  readonly name: N;
  readonly keys: readonly K[];
}

/** `derive.mentions`, `derive.links`, `derive.command`, `derive.text`. */
export const derive: { readonly [N in ExtractorName]: Extractor<N> } = Object.fromEntries(
  EXTRACTORS.map(name => [name, { name }]),
) as { readonly [N in ExtractorName]: Extractor<N> };

/**
 * Selects the keys of an extractor's output a handler reads. Every key must exist on that
 * extractor's output and at least one is required: a contract says exactly what it consumes.
 */
export function pick<N extends ExtractorName, const K extends OutputKey<N>>(
  extractor: Extractor<N>,
  ...keys: readonly [K, ...K[]]
): Derivable<N, K> {
  return { name: extractor.name, keys };
}

/**
 * The output of one extractor narrowed to the picked keys. A `null` result (not a command)
 * stays `null`: that is a fact, not a missing one.
 */
export type PickedOutput<N extends ExtractorName, K extends OutputKey<N>> =
  | Pick<NonNullable<ExtractorOutput[N]>, K>
  | (null extends ExtractorOutput[N] ? null : never);

/** The output of the extractors run on ONE field's plaintext, keyed by extractor name, each projected to the picked keys. */
export type FieldFacts = { [N in ExtractorName]?: Partial<NonNullable<ExtractorOutput[N]>> | (null extends ExtractorOutput[N] ? null : never) };

/**
 * The facts for a request: per source field, the output of the extractors its contract lists,
 * projected to the keys it picked. Keyed by field, so a handler reads
 * `derived.fields.content.mentions` and facts of different fields are never merged. A field is
 * absent when it carried no text (empty, null, not sent).
 */
export type DerivedFacts = { version: 2; fields: Record<string, FieldFacts> };

/**
 * Runtime shape check only: every key optional, since a contract picks a subset. The strict
 * per-contract type (`RequestDerived`) is what handlers are checked against.
 */
export const fieldFactsSchema: z.ZodType<FieldFacts> = z.object({
  mentions: z
    .object({
      userIds: z.array(z.string()).optional(),
      groupIds: z.array(z.string()).optional(),
      handles: z.array(z.string()).optional(),
      channel: z.boolean().optional(),
      here: z.boolean().optional(),
    })
    .optional(),
  links: z
    .object({
      all: z.array(z.string()).optional(),
      first: z.string().nullable().optional(),
      pr: z.array(z.string()).optional(),
      meet: z.array(z.string()).optional(),
    })
    .optional(),
  command: z
    .object({
      isBot: z.boolean().optional(),
      name: z.string().nullable().optional(),
      args: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  text: z
    .object({
      length: z.number().int().nonnegative().optional(),
      isEmpty: z.boolean().optional(),
    })
    .optional(),
});

export const derivedFactsSchema: z.ZodType<DerivedFacts> = z.object({
  version: z.literal(2),
  fields: z.record(z.string(), fieldFactsSchema),
});
