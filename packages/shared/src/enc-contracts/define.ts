import type { z } from 'zod';
import type { Derivable, ExtractorName, ExtractorOutput } from './extractors.js';
import { UnreadableString, isUnreadableSchema } from './unreadable-string.js';

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
 * One API's request type: the zod schema of its body and `sourceToDerived`. The route that
 * uses it attaches it where the route is registered (the path lives only there and, as the
 * rule's `value`, in the encryption service's database). What the sources are encrypted *to*
 * (the rule's `transform`) is policy in that database and reaches the backend and clients
 * through the manifest. The encryption service checks on each request that the contract and
 * the matched rule agree on field names and on which fields are encrypted.
 */
export interface RequestContract<S extends z.ZodObject = z.ZodObject, D extends SourceToDerived = SourceToDerived> {
  kind: 'REQUEST';
  schema: S;
  sourceToDerived: D;
  /** The fields the schema marks `unreadableString()`: handlers get them as `UnreadableString`, see `makeUnreadable`. */
  unreadableFields: readonly string[];
}

export function defineRequestContract<
  S extends z.ZodObject,
  const D extends SourceToDerived<FieldName<S>> = Record<never, never>,
>(contract: { schema: S; sourceToDerived?: D }): RequestContract<S, D> {
  return {
    kind: 'REQUEST',
    schema: contract.schema,
    sourceToDerived: (contract.sourceToDerived ?? {}) as D,
    unreadableFields: Object.entries(contract.schema.shape)
      .filter(([, field]) => isUnreadableSchema(field))
      .map(([name]) => name),
  };
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

/** The whole request as the handler sees it: the body as sent, and the derived facts (when there was text to derive from). */
export type RequestOf<C> = { body: RequestBody<C>; derived?: RequestDerived<C> };
