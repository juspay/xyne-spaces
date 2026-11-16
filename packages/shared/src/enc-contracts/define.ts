import type { z } from 'zod';

/**
 * One API's request shape: the zod schema of its body. The route that uses it attaches it
 * where the route is registered (the path lives only there and, as the rule's `value`, in
 * the encryption service's database). Encryption policy (which fields the client encrypts,
 * how the encryption service transforms them, what it extracts) is not here either: it
 * reaches the backend and clients through the manifest. The backend checks on each request
 * that the attached contract and the matched rule agree on field names.
 */
export interface RequestContract<S extends z.ZodObject = z.ZodObject> {
  kind: 'REQUEST';
  schema: S;
}

export function defineRequestContract<S extends z.ZodObject>(
  contract: Omit<RequestContract<S>, 'kind'>,
): RequestContract<S> {
  return { kind: 'REQUEST', ...contract };
}

/**
 * The body as the client sends it (the schema's input type, before transforms such as
 * `'true'` → `true`). Handlers see this type because the body is validated against the
 * schema only while API client encryption is on and is never replaced by the parsed value.
 */
export type RequestBody<C> = C extends RequestContract<infer S> ? z.input<S> : never;
