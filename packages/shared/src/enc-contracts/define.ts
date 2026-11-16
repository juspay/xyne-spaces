import type { z } from 'zod';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * One API's request shape: its route and the zod schema of its body. Encryption policy
 * (which fields the client encrypts, how the encryption service transforms them, what it
 * extracts) is not here: it lives in the encryption service's database and reaches the
 * backend and clients through the manifest. The backend checks at startup that the two
 * agree on field names (assertEncContractsMatchManifest).
 */
export interface RequestContract<S extends z.ZodObject = z.ZodObject> {
  kind: 'REQUEST';
  route: `${Method} /${string}`;
  schema: S;
}

export function defineRequestContract<S extends z.ZodObject>(
  contract: Omit<RequestContract<S>, 'kind'>,
): RequestContract<S> {
  return { kind: 'REQUEST', ...contract };
}

export type RequestBody<C> = C extends RequestContract<infer S> ? z.infer<S> : never;
