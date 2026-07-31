import { PrismaClient } from '@prisma/client';
import { logger } from '@/utils/logger';
import { vespaQueue } from '@/queues/vespaQueue';
import { userSchema } from '@/vespa/src/types';

/**
 * Prisma middleware that indexes every newly-created user into Vespa.
 *
 * User rows are created Prisma-direct across many paths (OAuth signup, invitation accept,
 * workspace/community provisioning, the public controller, bots) — none via Zero. Hooking
 * the shared client covers all of them uniformly, instead of wiring N call sites.
 *
 * Enqueues a durable `update` job with `create: true` — a partial upsert that creates a
 * missing doc WITHOUT wiping the personalization weights a full `feed` would replace.
 *
 * Fire-and-forget, NOT deferred. `$use` runs mid-operation and can't observe an enclosing
 * $transaction's COMMIT (e.g. community-workspace creation), so the job may be picked up
 * before the row is committed. Correctness rides on the WORKER, not on timing: it re-reads
 * the user (`db.user.findUnique`); if the row isn't there yet it throws and the Bull queue
 * RETRIES (attempts: 3, exponential backoff) until the row commits. A rolled-back create just
 * exhausts its retries — no phantom doc, only noise; acceptable for best-effort profile sync.
 * Best-effort: never blocks or fails the create.
 *
 * Only personalization weights are consumed from this doc today (read by docId); the profile
 * fields are written for when people-search needs them (see YqlBuilder.buildUserConditions).
 */
export function setupUserVespaSync(prisma: PrismaClient): void {
  prisma.$use(async (params, next) => {
    // Create/upsert only. Profile UPDATES (Prisma `user.update`, or the Zero
    // `tx.mutate.users.update` channel) are intentionally NOT synced yet: nothing consumes
    // the profile fields today (personalization reads only weights, by docId). Add an
    // update branch here (and/or a Zero users-handler) when people-search needs live profiles.
    if (params.model !== 'User' || (params.action !== 'create' && params.action !== 'upsert')) {
      return next(params);
    }

    const result = await next(params);

    const userId = result?.id as string | undefined;
    const workspaceId = result?.workspaceId as string | undefined;
    if (userId && workspaceId) {
      // Not deferred: the worker's re-read + Bull retry (see note above) is the fallback for
      // the pre-commit race, so setImmediate isn't needed. Fire-and-forget via `void`.
      void vespaQueue
        .addJob({
          schema: userSchema,
          jobType: 'update',
          docId: userId,
          userId,
          workspaceId,
          create: true,
        })
        .catch(error => {
          logger.error(`[USER_VESPA] Failed to enqueue Vespa sync for user ${userId}:`, error);
        });
    }

    return result;
  });
}
