/**
 * Operation Registry Types
 *
 * How an SDK method reaches the server. Two shapes:
 *
 *   SdkOperation  an operation id on the versioned API, resolved server-side
 *   ApiOperation  a versioned REST route the client addresses directly
 *
 * Nothing here names a backend operation. What `projects.update` runs, and how
 * its arguments are shaped, is decided in the backend's `api/sdk/v1/` — so the
 * catalog can be renamed or re-versioned without touching a published client.
 */

export type OperationType = 'sdk' | 'api';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * A direct REST API operation.
 * Executed via the specified HTTP method to /api/sdk/*
 */
export interface ApiOperation<TArgs = unknown, TResult = unknown> {
  readonly type: 'api';
  /** HTTP method */
  readonly method: HttpMethod;
  /** API endpoint path (e.g., '/api/sdk/v1/search') */
  readonly path: string | ((args: TArgs) => string);
  /** Transform SDK args to API request body/params */
  readonly mapArgs?: (args: TArgs) => unknown;
  /** Transform API response to SDK result */
  readonly mapResult?: (raw: unknown) => TResult;
}

export type Operation<TArgs = unknown, TResult = unknown> =
  | ApiOperation<TArgs, TResult>
  | SdkOperation<TArgs, TResult>;

// ----- v1 operations -----

/**
 * An operation on the versioned Spaces API.
 *
 * The SDK holds three things about it: the id to send, whether it reads or
 * writes, and the types either side of the call. It holds nothing about what the
 * server does with it — the catalog operation behind `projects.update`, and the
 * shaping of its arguments, live in the backend's `api/sdk/v1/{mapper,parser}.ts`.
 *
 * That split is what makes the SDK versioned rather than coupled: the server can
 * retarget an id onto a renamed or re-versioned catalog operation and every
 * already-published copy of this package keeps working.
 *
 * `kind` selects the endpoint (`/api/sdk/v1/query` or `/mutate`) and is the only
 * thing the client needs to know about the shape of the work; the server checks
 * it against its own map and rejects a mismatch.
 */
export interface SdkOperation<TArgs = unknown, TResult = unknown> {
  readonly type: 'sdk';
  /**
   * Phantom carrier for the request type. Never present at runtime.
   *
   * Without it `TArgs` appears nowhere in this interface, and `Resource.call`
   * has nothing to infer the argument type *from* — so every call would accept
   * any arguments at all. Declared as a function parameter so the check is
   * contravariant, which is what makes passing the wrong shape an error rather
   * than a silently widened one.
   */
  readonly _args?: (args: TArgs) => void;
  /** Operation id, e.g. `projects.update`. Stable for the life of this major version. */
  readonly op: string;
  readonly kind: 'query' | 'mutator' | 'direct';
  /**
   * Reshape the response before it reaches the caller.
   *
   * Only for making the declared return type true — collapsing a one-row list,
   * or lifting a server-minted id out of the envelope. Argument shaping has no
   * equivalent here: that is the server's parser.
   */
  readonly mapResult?: (raw: unknown) => TResult;
}

// ----- Helper Functions -----

/**
 * Define a direct API operation.
 *
 * @example
 * const searchUsers = api<{ query: string }, User[]>('GET', '/api/sdk/v1/users/search');
 */
export function api<TArgs = void, TResult = unknown>(
  method: HttpMethod,
  path: string | ((args: TArgs) => string),
  options?: {
    mapArgs?: (args: TArgs) => unknown;
    mapResult?: (raw: unknown) => TResult;
  }
): ApiOperation<TArgs, TResult> {
  return { type: 'api', method, path, ...options };
}

/**
 * The first row of a list result, or null.
 *
 * For a `mapResult` on a query that is logically singular but whose Zero
 * definition omits `.one()`, so the server sends an array. Declaring the singular
 * type without mapping is the bug this exists to prevent: the caller gets an array
 * typed as an object and every field reads `undefined`.
 *
 * Tolerates a server that does collapse the row, so the same mapping stays correct
 * if `.one()` is added to the query later.
 */
export function firstOrNull<T>(raw: unknown): T | null {
  if (Array.isArray(raw)) return (raw[0] as T) ?? null;
  return (raw as T | null | undefined) ?? null;
}

/**
 * Define an operation on the versioned API.
 *
 * @example
 * const update = op<{ projectId: string; name?: string }, void>('projects.update', 'mutator');
 */
export function op<TArgs = void, TResult = unknown>(
  id: string,
  kind: 'query' | 'mutator' | 'direct',
  options?: { mapResult?: (raw: unknown) => TResult }
): SdkOperation<TArgs, TResult> {
  return { type: 'sdk', op: id, kind, ...options };
}
