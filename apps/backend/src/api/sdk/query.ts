/**
 * Reads for /api/sdk.
 *
 * Execution belongs to `runCatalogQuery` in `zero/server.ts`, which is the same
 * code path the app's own query fallback takes. What is decided here is the two
 * things an HTTP surface has to decide for itself: which pool to read from, and
 * what a failure looks like to a client.
 */

import type { Context } from '@xyne/shared';
import {
  CatalogQueryError,
  dbProvider,
  replicaDbProvider,
  runCatalogQuery,
} from '@/zero/server';
import { ApiError } from './errors';
import { sdkConfig } from './config';

/**
 * Whether reads can be served at all in this deployment.
 *
 * Reported by `/health` so a misconfigured deployment is visible before a caller
 * discovers it one query at a time.
 */
export function readsAvailable(): boolean {
  return replicaDbProvider !== null || sdkConfig.allowPrimaryForReads;
}

/**
 * Run one catalog query as the authenticated caller.
 *
 * Reads go to the replica. Falling back to the primary is a development escape
 * hatch behind `SDK_QUERIES_ALLOW_PRIMARY`: the replica exists to keep this
 * traffic off the write path, so a deployment missing one is misconfigured
 * rather than merely slower.
 */
export async function callQuery<T = unknown>(
  name: string,
  args: unknown,
  ctx: Context,
): Promise<T> {
  const provider = replicaDbProvider ?? (sdkConfig.allowPrimaryForReads ? dbProvider : null);
  if (!provider) {
    throw new ApiError(
      'service_misconfigured',
      'Read replica is not configured for this deployment (DATABASE_READ_REPLICA_POOL_URL).',
    );
  }

  try {
    return (await runCatalogQuery(name, args, ctx, provider)) as T;
  } catch (err) {
    if (!(err instanceof CatalogQueryError)) throw err;
    switch (err.phase) {
      case 'unknown':
        throw new ApiError('invalid_request', err.message, { cause: err.cause });
      case 'build':
        throw new ApiError('validation_failed', err.message, { cause: err.cause });
      default:
        // The cause is logged, not returned: it carries SQL and connection detail.
        throw new ApiError('upstream_unavailable', 'The database is temporarily unavailable.', {
          cause: err.cause,
        });
    }
  }
}
