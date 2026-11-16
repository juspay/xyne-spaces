import type { z } from 'zod';
import type { ExtractorName, ExtractorOutput } from './extractors.js';

declare const encryptedBrand: unique symbol;
/** A field value the client encrypts: the handler only ever sees it as ciphertext. */
export type Encrypted<T = string> = T & { readonly [encryptedBrand]: true };

type FieldName<S extends z.ZodObject> = Extract<keyof z.input<S>, string>;

/**
 * One API's request type: the zod schema of its body, which of its fields the client
 * encrypts, and the facts its handler reads from `derived` (what the encryption service
 * extracts from the encrypted fields). The route that uses it attaches it where the route
 * is registered (the path lives only there and, as the rule's `value`, in the encryption
 * service's database). What the encrypted fields are encrypted *to* (the rule's `transform`
 * and `storage`), which extractors actually run and what is persisted is policy: it lives in
 * that database and reaches the backend and clients through the manifest. The encryption
 * service checks on each request that the attached contract and the matched rule agree on
 * field names and on which fields are encrypted.
 */
export interface RequestContract<
  S extends z.ZodObject = z.ZodObject,
  D extends ExtractorName = ExtractorName,
  E extends string = string,
> {
  kind: 'REQUEST';
  schema: S;
  /** Fields the client sends encrypted. */
  encrypted: readonly E[];
  /** Extractors whose output the handler reads from `derived`. */
  derived: readonly D[];
}

export function defineRequestContract<
  S extends z.ZodObject,
  const E extends FieldName<S> = never,
  const D extends ExtractorName = never,
>(contract: { schema: S; encrypted?: readonly E[]; derived?: readonly D[] }): RequestContract<S, D, E> {
  return {
    kind: 'REQUEST',
    schema: contract.schema,
    encrypted: contract.encrypted ?? [],
    derived: contract.derived ?? [],
  };
}

/**
 * The body as the client sends it (the schema's input type, before transforms such as
 * `'true'` → `true`). Handlers see this type because the body is validated against the
 * schema only while API client encryption is on and is never replaced by the parsed value.
 */
export type RequestBody<C> = C extends RequestContract<infer S, ExtractorName, infer E>
  ? { [K in keyof z.input<S>]: K extends E ? Encrypted<z.input<S>[K]> : z.input<S>[K] }
  : never;

/**
 * The facts a handler gets in `derived`: the extractors its contract names, each optional
 * because the manifest rule (policy, in the encryption service's database) decides which
 * ones run.
 */
export type RequestDerived<C> = C extends RequestContract<z.ZodObject, infer D, string>
  ? { version: 1 } & { [K in D]?: ExtractorOutput[K] }
  : never;

/** The whole request as the handler sees it: the body as sent, and the derived facts (when the encryption service transformed it). */
export type RequestOf<C> = { body: RequestBody<C>; derived?: RequestDerived<C> };
