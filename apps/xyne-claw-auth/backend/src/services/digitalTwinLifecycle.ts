/**
 * Digital Twin lifecycle primitives shared by the user route, the admin
 * controls and the backfill worker: the one write of the backfill-state JSONB
 * column, the disable sequence, and the enqueue-one-job-per-source loop.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { cancelDigitalTwinBackfill, enqueueDigitalTwinBackfill } from "../queue/digital-twin-backfill-queue.js";
import { BACKFILL_SOURCES, type BackfillState } from "./digitalTwinBackfillState.js";

/** Write User.digitalTwinBackfillState (null clears the column), optionally with
 *  the enable flag/timestamp in the same update. The state is ALWAYS written,
 *  even when null, so a stale value is never inherited. */
export async function writeBackfillState(
  userId: string,
  state: BackfillState | null,
  extra: { digitalTwinEnabled?: boolean; digitalTwinEnabledAt?: Date } = {},
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      ...extra,
      digitalTwinBackfillState: state
        ? (state as unknown as Prisma.InputJsonValue)
        : (Prisma.JsonNull as unknown as Prisma.NullableJsonNullValueInput),
    },
  });
}

/**
 * Turn the Twin off. Cancel in-flight backfill jobs first — otherwise they'll
 * keep walking history and writing candidates after the user opted out, costing
 * LLM budget for work that will sit in the review queue unwanted.
 *
 * Clear backfillState alongside the flag. If we left stale state, a future
 * re-enable would have the worker think the previous walk was already complete
 * and skip the new range. Returns how many jobs were cancelled.
 */
export async function disableTwin(userId: string): Promise<number> {
  const cancelledJobs = await cancelDigitalTwinBackfill(userId);
  await writeBackfillState(userId, null, { digitalTwinEnabled: false });
  return cancelledJobs;
}

/** Enqueue one backfill job per source over the same window, in source order.
 *  Returns the job ids. */
export async function enqueueBackfillForAllSources(
  userId: string,
  { from, to }: { from: Date; to: Date },
): Promise<string[]> {
  const jobIds: string[] = [];
  for (const source of BACKFILL_SOURCES) {
    jobIds.push(await enqueueDigitalTwinBackfill({ userId, source, from, to }));
  }
  return jobIds;
}
