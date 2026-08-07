/**
 * Write engine: run one named catalog mutator in a transaction.
 *
 * This is `handleMutateFallback` (src/zero/server.ts) rebuilt for a public API.
 * Same core — `createMutators` + `wrapTransactionWithACL` + `mustGetMutator`, so
 * write ACL, Vespa indexing, and side-effect jobs behave exactly as they do for
 * the app — with three differences that matter for HTTP callers:
 *
 *  1. Failures throw typed errors. The fallback handler returns HTTP 200 with
 *     `{success:false}`, which no HTTP client can be expected to notice.
 *  2. Idempotency is enforced *inside the mutator's own transaction*. Roughly 35
 *     mutators mint uuids internally, so a naive retry would duplicate rows; a
 *     Redis-side cache could not prevent that because it commits separately.
 *  3. Post-commit side effects (notifications, search indexing) fire only on
 *     first execution. A replay returns the stored response and runs nothing.
 */

import { mustGetMutator } from '@rocicorp/zero';
import type { Context } from '@xyne/shared';
import { createHash } from 'node:crypto';
import { createMutators, type AuthData } from '@/zero/mutators';
import { dbProvider } from '@/zero/server';
import { wrapTransactionWithACL } from '@/zero/acl';
import {
  createVespaJobsAccumulator,
  type VespaJobsAccumulator,
} from '@/zero/vespa-injection';
import {
  createSideEffectJobsAccumulator,
  processSideEffectJobs,
  type SideEffectJobsAccumulator,
} from '@/zero/side-effects';
import { vespaQueue } from '@/queues/vespaQueue';
import { db } from '@/database/client';
import { runWithContext } from '@/database/tenant/context';
import { NAMESPACE } from '@/vespa/vespaConfig';
import { VespaOperationType } from '@/zero/vespa-injection/core/mapper';
import { logger } from '@/utils/logger';
import { ApiError, toApiError } from '../errors';
import { v1Config } from '../config';

export interface CallMutatorInput {
  readonly name: string;
  readonly args: unknown;
  readonly authData: AuthData;
  readonly ctx: Context;
  /** Endpoint identity, so the same key on a different route is a distinct record. */
  readonly endpoint: string;
  readonly idempotencyKey?: string;
}

export interface CallMutatorResult {
  /** True when a stored response was returned and nothing was executed. */
  readonly replayed: boolean;
  readonly storedResponse?: { status: number; body: unknown };
}

interface PgQueryable {
  query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

const IDEMPOTENCY_TABLE = 'non_zero.sdk_idempotency_keys';

export async function callMutator(input: CallMutatorInput): Promise<CallMutatorResult> {
  const { name, args, authData, ctx, endpoint, idempotencyKey } = input;

  const asyncTasks: Array<() => Promise<void>> = [];
  const vespaJobs: VespaJobsAccumulator = createVespaJobsAccumulator();
  const sideEffectJobs: SideEffectJobsAccumulator = createSideEffectJobsAccumulator();
  const requestHash = hashRequest(name, args);

  let replayed = false;
  let storedResponse: { status: number; body: unknown } | undefined;

  try {
    await dbProvider.transaction(async (tx) => {
      if (idempotencyKey) {
        const claim = await claimIdempotencyKey(
          tx.dbTransaction as unknown as PgQueryable,
          idempotencyKey,
          authData.sub,
          endpoint,
          requestHash,
        );
        if (claim.kind === 'replay') {
          replayed = true;
          storedResponse = claim.response;
          return;
        }
      }

      const mutators = createMutators(authData, asyncTasks);
      const wrappedTx = wrapTransactionWithACL(tx, ctx, vespaJobs, sideEffectJobs);
      const mutator = mustGetMutator(mutators, name);
      // Args are validated by the mutator's own zod schema on the next line;
      // the cast only satisfies Zero's ReadonlyJSONValue parameter type.
      await mutator.fn({ tx: wrappedTx, args: args as never, ctx });
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    logger.warn('[v1] mutation failed', { name, endpoint, err });
    throw toApiError(err);
  }

  // A replay must not re-notify, re-index, or re-run any async task — the
  // original execution already did all of it.
  if (replayed) {
    return { replayed: true, ...(storedResponse ? { storedResponse } : {}) };
  }

  drainSideEffects(authData, ctx, asyncTasks, vespaJobs, sideEffectJobs);
  return { replayed: false };
}

/**
 * Record the response for a completed idempotent write so a later retry can be
 * answered without re-executing. Best-effort: if this fails the retry gets a
 * 409 `idempotency_in_flight` and re-reads, which is safe, just less pleasant.
 */
export async function recordIdempotentResponse(
  key: string,
  userId: string,
  endpoint: string,
  status: number,
  body: unknown,
): Promise<void> {
  try {
    await (dbProvider as unknown as { transaction: (fn: (tx: { dbTransaction: PgQueryable }) => Promise<void>) => Promise<void> }).transaction(
      async (tx) => {
        await tx.dbTransaction.query(
          `UPDATE ${IDEMPOTENCY_TABLE}
             SET response_status = $1, response_body = $2
           WHERE key = $3 AND user_id = $4 AND endpoint = $5`,
          [status, JSON.stringify(body ?? null), key, userId, endpoint],
        );
      },
    );
  } catch (err) {
    logger.warn('[v1] failed to record idempotent response', { endpoint, err });
  }
}

type ClaimResult =
  | { kind: 'claimed' }
  | { kind: 'replay'; response: { status: number; body: unknown } | undefined };

/**
 * Insert the key inside the caller's transaction so it commits atomically with
 * the write. That coupling is the whole mechanism: if the mutator rolls back,
 * so does the key, and the client is free to retry.
 */
async function claimIdempotencyKey(
  pg: PgQueryable,
  key: string,
  userId: string,
  endpoint: string,
  requestHash: string,
): Promise<ClaimResult> {
  const expiresAt = new Date(Date.now() + v1Config.idempotency.ttlHours * 3600_000);

  const inserted = await pg.query(
    `INSERT INTO ${IDEMPOTENCY_TABLE} (id, key, user_id, endpoint, request_hash, created_at, expires_at)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, NOW(), $5)
     ON CONFLICT (user_id, endpoint, key) DO NOTHING
     RETURNING id`,
    [key, userId, endpoint, requestHash, expiresAt],
  );

  if (inserted.rows.length > 0) return { kind: 'claimed' };

  const existing = await pg.query(
    `SELECT request_hash, response_status, response_body
       FROM ${IDEMPOTENCY_TABLE}
      WHERE user_id = $1 AND endpoint = $2 AND key = $3`,
    [userId, endpoint, key],
  );
  const row = existing.rows[0];
  if (!row) {
    // Raced with a TTL cleanup between the insert and the select. Treating this
    // as in-flight is the conservative answer — the client retries.
    throw new ApiError('idempotency_in_flight', 'Retry this request.', { retryAfterSeconds: 1 });
  }

  if (row['request_hash'] !== requestHash) {
    throw new ApiError(
      'idempotency_key_conflict',
      'This Idempotency-Key was already used with a different request body.',
    );
  }

  const status = row['response_status'];
  if (typeof status !== 'number') {
    throw new ApiError(
      'idempotency_in_flight',
      'A request with this Idempotency-Key is still in progress.',
      { retryAfterSeconds: 1 },
    );
  }

  return { kind: 'replay', response: { status, body: row['response_body'] } };
}

function hashRequest(name: string, args: unknown): string {
  return createHash('sha256').update(`${name}:${stableStringify(args)}`).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

/**
 * Post-commit work, copied from the fallback handler's behaviour: async tasks,
 * Vespa indexing jobs, then side-effect handlers under a Prisma tenant context
 * (side effects write through Prisma, which has no tenant middleware here, so
 * workspaceId must be supplied explicitly).
 *
 * Fire-and-forget, matching the app: a failed notification must not fail the
 * write that already committed.
 */
function drainSideEffects(
  authData: AuthData,
  ctx: Context,
  asyncTasks: Array<() => Promise<void>>,
  vespaJobs: VespaJobsAccumulator,
  sideEffectJobs: SideEffectJobsAccumulator,
): void {
  void Promise.allSettled(asyncTasks.map((task) => task()));

  void Promise.allSettled(
    vespaJobs.map(async (job) => {
      try {
        await vespaQueue.addJob({
          schema: job.schema,
          jobType: job.jobType,
          docId: job.docId,
          userId: authData.sub,
          workspaceId: authData.workspaceId,
          ...(job.jobType === 'update' ? { data: job.data } : {}),
        });
      } catch (err) {
        try {
          await db.vespaInsertionLogs.create({
            data: {
              status: 'FAILED',
              type: VespaOperationType[job.jobType],
              entityId: job.docId,
              entityType: job.schema,
              namespace: NAMESPACE,
              errorMessage: `Failed to enqueue a job ${JSON.stringify(err)}`,
              errorDetails: JSON.stringify(err),
              userId: authData.sub,
              workspaceId: authData.workspaceId,
              createdAt: new Date(),
            },
          });
        } catch (dbError) {
          logger.error('[v1] failed to log vespa enqueue error', { dbError });
        }
      }
    }),
  );

  void runWithContext(
    {
      userId: authData.sub,
      workspaceId: authData.workspaceId,
      role: authData.role,
      orgRole: authData.orgRole,
      memberId: authData.memberId,
    },
    () => processSideEffectJobs(sideEffectJobs, ctx),
  );
}
