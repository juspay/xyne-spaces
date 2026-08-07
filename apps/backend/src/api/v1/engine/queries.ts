/**
 * Read engine: run one named catalog query and return rows.
 *
 * This is `handleQueriesFallback` (src/zero/server.ts) rebuilt for a public API:
 *  - one server-bound query per call, never a client-supplied batch
 *  - typed errors instead of a rejected Promise.all
 *  - a 503 instead of a throw when the read replica is not configured
 *
 * The ACL story is unchanged and that is the point: `queryDef.fn` runs the same
 * `defineQuery` wrapper the app uses, so the per-table read ACL is folded into
 * the AST before any SQL is generated. There is no second authorization path to
 * keep in sync.
 */

import { mustGetQuery } from '@rocicorp/zero';
import { schema } from '@xyne/shared';
import type { Context } from '@xyne/shared';
import { queries } from '@/zero/queries';
import {
  dbProvider,
  replicaDbProvider,
  fetchServerSchema,
  conformToZeroShape,
  type ZeroResultFormat,
} from '@/zero/server';
import { logger } from '@/utils/logger';
import { ApiError } from '../errors';
import { v1Config } from '../config';
import { asQueryInternals, executePostgresQuery } from './zero-internals';

export interface CallQueryOptions {
  /**
   * Read from the primary pool instead of the replica. Used by the paired-read
   * that follows a write, where replication lag would return a stale row (or
   * none at all, for a just-created resource).
   */
  readonly usePrimary?: boolean;
}

/** Whether reads can be served at all in this deployment. */
export function readsAvailable(): boolean {
  return replicaDbProvider !== null || v1Config.allowPrimaryForReads;
}

function readProvider(usePrimary: boolean): typeof dbProvider {
  if (usePrimary) return dbProvider;
  if (replicaDbProvider) return replicaDbProvider;
  if (v1Config.allowPrimaryForReads) return dbProvider;
  throw new ApiError(
    'service_misconfigured',
    'Read replica is not configured for this deployment (DATABASE_READ_REPLICA_POOL_URL).',
  );
}

export async function callQuery<T = unknown>(
  name: string,
  args: unknown,
  ctx: Context,
  options: CallQueryOptions = {},
): Promise<T> {
  const provider = readProvider(options.usePrimary === true);

  let queryDef: { fn: (input: { args: unknown; ctx: Context }) => unknown };
  try {
    queryDef = mustGetQuery(queries, name) as typeof queryDef;
  } catch (err) {
    // A manifest entry naming a query that no longer exists is a deployment
    // bug, not a client error.
    logger.error('[v1] unknown query in route manifest', { name, err });
    throw new ApiError('internal', `Query "${name}" is not registered.`, { cause: err });
  }

  let ast: unknown;
  let format: unknown;
  try {
    const query = queryDef.fn({ args, ctx });
    ({ ast, format } = asQueryInternals(query));
  } catch (err) {
    // Errors here come from the query body or its zod validator — bad arguments.
    throw new ApiError('validation_failed', errMessage(err), { cause: err });
  }

  const serverSchema = await fetchServerSchema();

  try {
    const data = await provider.transaction(async (tx) =>
      executePostgresQuery(tx.dbTransaction, ast, format, schema, serverSchema),
    );
    conformToZeroShape(data, format as ZeroResultFormat);
    return data as T;
  } catch (err) {
    logger.error('[v1] query execution failed', { name, err });
    throw new ApiError('upstream_unavailable', 'The database is temporarily unavailable.', {
      cause: err,
    });
  }
}

/**
 * Run a query declared `.one()` and 404 when it comes back empty.
 *
 * A row hidden by the read ACL is indistinguishable from a row that does not
 * exist — both produce 404, deliberately, so the API is not an existence oracle
 * for resources the caller cannot see.
 */
export async function callQueryOne<T = unknown>(
  name: string,
  args: unknown,
  ctx: Context,
  resourceLabel: string,
  options: CallQueryOptions = {},
): Promise<T> {
  const result = await callQuery<T | undefined | null>(name, args, ctx, options);
  if (result === undefined || result === null) {
    throw ApiError.notFound(resourceLabel);
  }
  return result;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Invalid query arguments.';
}
