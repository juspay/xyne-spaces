/**
 * Write engine: run one named catalog mutator in a transaction.
 *
 * The sequence — `createMutators`, `wrapTransactionWithACL`, `mustGetMutator` —
 * is the one the app itself uses, so write ACL, Vespa indexing, and side-effect
 * jobs behave identically here. Failures throw rather than resolving to
 * `{success:false}`, because an HTTP caller cannot be expected to inspect a 200
 * body to discover that its write did not happen.
 */

import { mustGetMutator } from '@rocicorp/zero';
import type { Context } from '@xyne/shared';
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

export interface CallMutatorInput {
  readonly name: string;
  readonly args: unknown;
  readonly authData: AuthData;
  readonly ctx: Context;
}

export async function callMutator(input: CallMutatorInput): Promise<void> {
  const { name, args, authData, ctx } = input;

  const asyncTasks: Array<() => Promise<void>> = [];
  const awaitedPostCommitTasks: Array<() => Promise<void>> = [];
  const vespaJobs: VespaJobsAccumulator = createVespaJobsAccumulator();
  const sideEffectJobs: SideEffectJobsAccumulator = createSideEffectJobsAccumulator();

  try {
    await dbProvider.transaction(async (tx) => {
      const mutators = createMutators(authData, asyncTasks, awaitedPostCommitTasks);
      const wrappedTx = wrapTransactionWithACL(tx, ctx, vespaJobs, sideEffectJobs);
      const mutator = mustGetMutator(mutators, name);
      // Args are validated by the mutator's own zod schema on the next line;
      // the cast only satisfies Zero's ReadonlyJSONValue parameter type.
      await mutator.fn({ tx: wrappedTx, args: args as never, ctx });
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    logger.warn('[sdk] mutation failed', { name, err });
    throw toApiError(err);
  }

  await Promise.allSettled(awaitedPostCommitTasks.map((task) => task()));
  drainSideEffects(authData, ctx, asyncTasks, vespaJobs, sideEffectJobs);
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
          logger.error('[sdk] failed to log vespa enqueue error', { dbError });
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
