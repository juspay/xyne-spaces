import type { z } from 'zod';
import type { Derivable, ExtractorName, ExtractorOutput } from './extractors.js';
import { UnreadableString, isUnreadableSchema, reveal } from './unreadable-string.js';

/**
 * Marks an object as made by `defineRequestContract`. Not exported, so nothing outside this
 * folder can name it: a contract can only be defined here, next to the others.
 */
const contractBrand: unique symbol = Symbol('RequestContract');

declare const encryptedBrand: unique symbol;
/** A field value the client encrypts: the handler only ever sees it as ciphertext. */
export type Encrypted<T = string> = T & { readonly [encryptedBrand]: true };

type FieldName<S extends z.ZodObject> = Extract<keyof z.input<S>, string>;

/** The facts derived from one source field: fact name -> its handle (`derive.<name>`), the key and the handle must agree. */
export type DerivedSpec = { readonly [N in ExtractorName]?: Derivable<N> };

/**
 * Which fields the client encrypts (the sources) and, per source, exactly the facts the handler
 * reads instead of its plaintext:
 *
 *   sourceToDerived: {
 *     content: { userIds: derive.userIds, meetLinks: derive.meetLinks },
 *     subject: {},
 *   }
 *
 * Each key is a field of the schema. Its object names the facts computed from that field's
 * plaintext; `derived.fields.<key>` holds exactly those, nothing more. `{}` means the field is
 * encrypted and stored, nothing is derived from it. This is the single source of truth for
 * extraction: the encryption service computes what it says, and so does the backend when the
 * client sent plaintext. A fact a handler (or its side effects) reads but did not list is a
 * compile error where it is read.
 */
export type SourceToDerived<F extends string = string> = { readonly [K in F]?: DerivedSpec };

/**
 * One API's types: the zod schema of its request body, `sourceToDerived` and, for an HTTP API,
 * the `response` it answers with. The route that uses it attaches it where the route is
 * registered (the path lives only there and, as the rule's `value`, in the encryption
 * service's database). What the sources are encrypted *to*
 * (the rule's `transform`) is policy in that database and reaches the backend and clients
 * through the manifest. The encryption service checks on each request that the contract and
 * the matched rule agree on field names and on which fields are encrypted.
 *
 * Contracts are defined only in this folder (`defineRequestContract` is not exported from the
 * package) and an HTTP one is listed in `API` (api.ts), which is what the backend serves from.
 */
export interface RequestContract<
  S extends z.ZodObject = z.ZodObject,
  D extends SourceToDerived = SourceToDerived,
  R extends z.ZodType | undefined = z.ZodType | undefined,
> {
  readonly [contractBrand]: true;
  kind: 'REQUEST';
  schema: S;
  sourceToDerived: D;
  /**
   * The JSON body of a 2xx response. Absent for a Zero mutator. A field marked
   * `unreadableString()` is an `UnreadableString` in the handler's hands and becomes its text
   * only as the response is written (`makeReadable`).
   */
  response: R;
  /** The response fields marked `unreadableString()`. */
  unreadableResponseFields: readonly string[];
  /** The fields the schema marks `unreadableString()`: handlers get them as `UnreadableString`, see `makeUnreadable`. */
  unreadableFields: readonly string[];
}

export function defineRequestContract<
  S extends z.ZodObject,
  const D extends SourceToDerived<FieldName<S>> = Record<never, never>,
  R extends z.ZodType | undefined = undefined,
>(contract: { schema: S; sourceToDerived?: D; response?: R }): RequestContract<S, D, R> {
  return {
    [contractBrand]: true,
    kind: 'REQUEST',
    schema: contract.schema,
    sourceToDerived: (contract.sourceToDerived ?? {}) as D,
    response: contract.response as R,
    unreadableResponseFields: unreadableFieldNames((contract.response as { shape?: unknown } | undefined)?.shape),
    unreadableFields: unreadableFieldNames(contract.schema.shape),
  };
}

/** The keys of an object schema's shape that are marked `unreadableString()`; none for anything else. */
function unreadableFieldNames(shape: unknown): string[] {
  if (!shape || typeof shape !== 'object') return [];
  return Object.entries(shape)
    .filter(([, field]) => isUnreadableSchema(field))
    .map(([name]) => name);
}

/** The names of the fields a contract encrypts. */
export function sourceFieldNames(contract: RequestContract): string[] {
  return Object.keys(contract.sourceToDerived);
}

/** `{ <field>: [<fact names>] }`: the contract's `sourceToDerived` in wire form, what the encryption service takes as `contractDerived` and the local extractor runs. */
export function derivedNames(contract: RequestContract): Record<string, ExtractorName[]> {
  return Object.fromEntries(
    Object.entries(contract.sourceToDerived).map(([field, spec]) => [
      field,
      Object.values(spec ?? {}).flatMap(d => (d ? [d.name] : [])),
    ]),
  );
}

type IsAny<T> = 0 extends 1 & T ? true : false;

/** The names of the fields a schema marks `unreadableString()`. */
type UnreadableFieldName<S extends z.ZodObject> = {
  [K in keyof z.output<S>]: IsAny<z.output<S>[K]> extends true
    ? never
    : [NonNullable<z.output<S>[K]>] extends [UnreadableString]
      ? K
      : never;
}[keyof z.output<S>];

/** `T` as an `UnreadableString`, keeping `null` / `undefined` as they are. */
type Unreadable<T> = UnreadableString | Extract<T, null | undefined>;

/**
 * The body as the client sends it (the schema's input type, before transforms such as
 * `'true'` → `true`), with the `unreadableString()` fields wrapped in `UnreadableString` so a handler
 * cannot read them without `reveal()`, and the other source fields branded as ciphertext. Handlers see
 * this type because the body is validated against the schema only while API client encryption
 * is on and is never replaced by the parsed value; `makeUnreadable` does the wrapping.
 */
export type RequestBody<C> = C extends RequestContract<infer S, infer D>
  ? {
      [K in keyof z.input<S>]: K extends UnreadableFieldName<S>
        ? Unreadable<z.input<S>[K]>
        : K extends keyof D
          ? Encrypted<z.input<S>[K]>
          : z.input<S>[K];
    }
  : never;

/** `B` with the contract's `unreadableString()` fields wrapped; every other field keeps `B`'s own type. */
export type UnreadableBody<C, B> = C extends RequestContract<infer S, SourceToDerived>
  ? { [K in keyof B]: K extends UnreadableFieldName<S> ? Unreadable<B[K]> : B[K] }
  : never;

/**
 * A copy of `body` with the contract's `unreadableString()` fields wrapped in `UnreadableString`. Run it where
 * the body enters handler code (the route middleware, the first line of a mutator), so the
 * handler never holds those fields as plain values. Absent and null fields stay as they are.
 */
export function makeUnreadable<C extends RequestContract, B extends object>(contract: C, body: B): UnreadableBody<C, B> {
  const wrapped = { ...body } as Record<string, unknown>;
  for (const field of contract.unreadableFields) {
    const value = wrapped[field];
    if (value !== undefined && value !== null && !(value instanceof UnreadableString)) {
      // The schema says string; whatever arrived is wrapped as it is, never left readable.
      wrapped[field] = UnreadableString.make(value as string);
    }
  }
  return wrapped as UnreadableBody<C, B>;
}

/** The facts of one source field: exactly the names its contract entry lists, each with its `ExtractorOutput` type. */
export type FieldDerived<D, F extends keyof D> = {
  [N in Extract<keyof NonNullable<D[F]>, ExtractorName>]: ExtractorOutput[N];
};

/**
 * The facts a handler gets in `derived`: per source field, the facts the contract lists for
 * it. A field is absent when it carried no text (empty, null, not sent); when present, every
 * listed fact is there.
 */
export type RequestDerived<C> = C extends RequestContract<z.ZodObject, infer D>
  ? { version: 2; fields: { [F in keyof D]?: FieldDerived<D, F> } }
  : never;

/**
 * The 2xx response body a handler builds for a contract that declares one: its
 * `unreadableString()` fields are `UnreadableString`, so the handler passes them on without
 * reading them.
 */
export type ResponseBody<C> = C extends { response: infer R extends z.ZodType } ? z.output<R> : never;

/**
 * The response as it goes over the wire: a copy of `body` with the contract's unreadable
 * response fields turned back into their text. Run it where the response is written (the
 * route middleware), never in a handler. Without it those fields serialize as `<redacted>`.
 */
export function makeReadable(contract: RequestContract, body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body) || contract.unreadableResponseFields.length === 0) {
    return body;
  }
  const readable = { ...body } as Record<string, unknown>;
  for (const field of contract.unreadableResponseFields) {
    const value = readable[field];
    if (value instanceof UnreadableString) readable[field] = reveal(value);
  }
  return readable;
}

/** The whole request as the handler sees it: the body as sent, and the derived facts (when there was text to derive from). */
export type RequestOf<C> = { body: RequestBody<C>; derived?: RequestDerived<C> };
