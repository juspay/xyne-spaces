import type { Prisma } from '@prisma/client';
import type { ReadonlyJSONValue, Transaction } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { v4 as uuidv4 } from 'uuid';
import { recordTicketTimelineEvent } from '@/services/ticketTimelineEventService';
import { getTicketBotActorId } from '@/utils/etaNotificationUtils';
import type { EtaActivityIntent } from './activityIntents';

export interface EtaActivityWriteContext {
  ticketId: string;
  workspaceId: string;
  channelId: string | null;
  /** Event timestamp; pass the mutation's own `now` so client/server runs agree. */
  timestamp: number;
  /**
   * Pre-resolved ticket-bot actor id. Optional, but pass it when the caller
   * already resolved it outside its transaction - that lookup is a DB read,
   * and callers holding a transaction shouldn't pay for it on the held
   * connection. Omitted, the helper resolves it lazily (only when there is at
   * least one intent to write).
   */
  systemActorId?: string;
}

/**
 * Persist ETA activity intents from a Prisma write path, inside the caller's
 * transaction. Attributed to the workspace's ticket-bot actor, since these
 * rows record automatic recalculation rather than a user-authored edit.
 *
 * No-ops on an empty intent list, so the bot-user lookup is skipped entirely
 * when an evaluation produced nothing to record (the common case).
 */
export async function writeEtaActivitiesPrisma(
  client: Prisma.TransactionClient,
  intents: ReadonlyArray<EtaActivityIntent>,
  ctx: EtaActivityWriteContext,
): Promise<void> {
  if (intents.length === 0) return;
  const systemActorId = ctx.systemActorId ?? (await getTicketBotActorId(ctx.workspaceId));
  for (const intent of intents) {
    await recordTicketTimelineEvent(
      {
        activity: {
          ticketId: ctx.ticketId,
          updatedBy: systemActorId,
          activityType: intent.activityType,
          value: intent.value as Prisma.InputJsonValue,
          workspaceId: ctx.workspaceId,
          channelId: ctx.channelId,
          timestamp: new Date(ctx.timestamp),
        },
      },
      client,
    );
  }
}

/**
 * Zero-mutator counterpart to {@link writeEtaActivitiesPrisma}, writing the
 * same rows with the same shapes through `tx.mutate` so the two write paths
 * can't drift.
 */
export async function writeEtaActivitiesZero(
  tx: Transaction<Schema>,
  intents: ReadonlyArray<EtaActivityIntent>,
  ctx: EtaActivityWriteContext,
): Promise<void> {
  if (intents.length === 0) return;
  const systemActorId = ctx.systemActorId ?? (await getTicketBotActorId(ctx.workspaceId));
  for (const intent of intents) {
    await tx.mutate.ticket_activities.insert({
      workspaceId: ctx.workspaceId,
      id: uuidv4(),
      ticketId: ctx.ticketId,
      updatedBy: systemActorId,
      timestamp: ctx.timestamp,
      activityType: intent.activityType,
      value: intent.value as ReadonlyJSONValue,
      ...(ctx.channelId != null ? { channelId: ctx.channelId } : {}),
    });
  }
}
