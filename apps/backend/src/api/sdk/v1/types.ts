/**
 * Shared types for the v1 SDK surface.
 *
 * v1 is a *versioned contract*, not a view onto the Zero catalog. A client names
 * an SDK operation — `projects.update` — and this layer decides what that means
 * today. The catalog can be renamed, re-keyed or re-versioned underneath without
 * the client knowing, which is the whole reason the mapping lives here rather
 * than in the published package.
 *
 * Two pieces, deliberately separate:
 *
 *   mapper.ts   operation id  ->  where it goes (Zero query, Zero mutator, route)
 *   parser.ts   operation id  ->  how its arguments are shaped for that target
 *
 * An operation always needs the first and usually not the second, so keeping
 * them apart means the common case is a one-line mapper entry with no parser at
 * all.
 */

export type V1Kind = 'query' | 'mutator' | 'direct';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Where an operation id resolves to. */
export type V1Target =
  | { readonly kind: 'query'; readonly name: string }
  | { readonly kind: 'mutator'; readonly name: string }
  | {
      readonly kind: 'direct';
      readonly method: HttpMethod;
      /** Built per-call, since most direct routes carry an id in the path. */
      readonly path: (args: Record<string, unknown>) => string;
    };

/**
 * What a parser produces.
 *
 * `generated` exists because Zero's optimistic-write model makes the *caller*
 * supply the primary key of any row it creates. That is an implementation detail
 * of Zero, so v1 mints those ids here instead and returns them — the client asked
 * to send a message, not to invent a message id. Anything listed here is echoed
 * in the response so the caller still learns the id of what it just created.
 */
export interface V1Parsed {
  readonly args: unknown;
  readonly generated?: Readonly<Record<string, string>>;
}

/**
 * Shapes one operation's arguments for its target.
 *
 * Receives exactly what the client sent, after the route has confirmed the
 * operation exists. Returning `generated` is what makes a minted id visible to
 * the caller; a parser that only reshapes arguments can leave it off.
 */
export type V1Parser = (args: V1Args) => V1Parsed;

/**
 * Arguments as they arrive from a client.
 *
 * Deliberately permissive. This layer reshapes and forwards; it does not
 * validate. The authority on whether an argument is acceptable is the target's
 * own zod schema, which runs immediately after and rejects anything wrong with a
 * precise message. Re-typing every field here would duplicate that schema in a
 * second place and guarantee the two drift.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type V1Args = Record<string, any>;
