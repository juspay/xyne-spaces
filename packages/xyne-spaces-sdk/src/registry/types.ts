/**
 * Operation Registry Types
 *
 * Defines the types for mapping SDK methods to backend operations.
 * Operations can be:
 * - Zero queries (via /zero/query-fallback)
 * - Zero mutators (via /zero/push-fallback)
 * - Direct API calls (via /api/v1/*)
 */

export type OperationType = 'query' | 'mutator' | 'api';

/**
 * A Zero query operation.
 * Executed via POST /zero/query-fallback
 */
export interface QueryOperation<TArgs = unknown, TResult = unknown> {
  readonly type: 'query';
  /** Zero query name (defined in backend Zero queries) */
  readonly name: string;
  /** Transform SDK args to Zero query args */
  readonly mapArgs?: (args: TArgs) => unknown;
  /** Transform Zero result to SDK result */
  readonly mapResult?: (raw: unknown) => TResult;
}

/**
 * A Zero mutator operation.
 * Executed via POST /zero/push-fallback
 */
export interface MutatorOperation<TArgs = unknown, TResult = unknown> {
  readonly type: 'mutator';
  /** Zero mutator name (defined in backend Zero mutators) */
  readonly name: string;
  /** Transform SDK args to Zero mutator args */
  readonly mapArgs?: (args: TArgs) => unknown;
  /** Transform Zero result to SDK result */
  readonly mapResult?: (raw: unknown) => TResult;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * A direct REST API operation.
 * Executed via the specified HTTP method to /api/v1/*
 */
export interface ApiOperation<TArgs = unknown, TResult = unknown> {
  readonly type: 'api';
  /** HTTP method */
  readonly method: HttpMethod;
  /** API endpoint path (e.g., '/api/v1/search') */
  readonly path: string | ((args: TArgs) => string);
  /** Transform SDK args to API request body/params */
  readonly mapArgs?: (args: TArgs) => unknown;
  /** Transform API response to SDK result */
  readonly mapResult?: (raw: unknown) => TResult;
}

export type Operation<TArgs = unknown, TResult = unknown> =
  | QueryOperation<TArgs, TResult>
  | MutatorOperation<TArgs, TResult>
  | ApiOperation<TArgs, TResult>;

// ----- Helper Functions -----

/**
 * Define a Zero query operation.
 *
 * @example
 * const getUser = query<{ userId: string }, User>('getUserById');
 */
export function query<TArgs = void, TResult = unknown>(
  name: string,
  options?: {
    mapArgs?: (args: TArgs) => unknown;
    mapResult?: (raw: unknown) => TResult;
  }
): QueryOperation<TArgs, TResult> {
  return { type: 'query', name, ...options };
}

/**
 * Define a Zero mutator operation.
 *
 * @example
 * const updateUser = mutator<{ userId: string; name: string }, User>('updateUser');
 */
export function mutator<TArgs = void, TResult = unknown>(
  name: string,
  options?: {
    mapArgs?: (args: TArgs) => unknown;
    mapResult?: (raw: unknown) => TResult;
  }
): MutatorOperation<TArgs, TResult> {
  return { type: 'mutator', name, ...options };
}

/**
 * Define a direct API operation.
 *
 * @example
 * const searchUsers = api<{ query: string }, User[]>('GET', '/api/v1/users/search');
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
