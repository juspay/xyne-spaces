import { Prisma } from '@prisma/client';
import { db } from '@/database/client';
import { ChannelType } from '@xyne/shared';
import { rawQuery } from './base';

/**
 * Resets updatedAt back to createdAt for a batch of activity rows, so activities untouched
 * since creation don't carry a stale updatedAt from an earlier bug. SQL unchanged from the
 * original call site.
 */
export function resetActivityUpdatedAtToCreatedAt(idsToUpdate: string[]): Promise<number> {
  return rawQuery(
    ['Activity'],
    'admin backfill: reset updatedAt to createdAt for untouched activity rows, across every workspace',
    () => db.$executeRaw`
      UPDATE "activities"
      SET "updatedAt" = "createdAt"
      WHERE "id" = ANY(${idsToUpdate})
        AND "updatedAt" <> "createdAt"
    `,
  );
}

/**
 * Stamps isThreadActivity on a batch of activity rows, computed from whether their message was
 * the conversation's initial message. SQL unchanged from the original call site.
 */
export function stampActivityIsThreadActivity(threadIds: string[], channelIds: string[]): Promise<[number, number]> {
  return rawQuery(
    ['Activity'],
    'admin backfill: stamp isThreadActivity across every workspace',
    async () => {
      let threadUpdated = 0;
      let channelUpdated = 0;
      if (threadIds.length > 0) {
        threadUpdated = await db.$executeRaw`
          UPDATE activities
          SET "isThreadActivity" = true
          WHERE id = ANY(${threadIds}::text[])`;
      }
      if (channelIds.length > 0) {
        channelUpdated = await db.$executeRaw`
          UPDATE activities
          SET "isThreadActivity" = false
          WHERE id = ANY(${channelIds}::text[])`;
      }
      return [threadUpdated, channelUpdated];
    },
  );
}

/**
 * Same page of tickets the Prisma query builder path fetches, but joined against channels to
 * filter to EMAIL-type channels — a join the typed client cannot express directly. SQL unchanged
 * from the original call site.
 */
export function vespaBackfillEmailTicketsPage(
  batchSize: number,
  skip: number,
  cutoffTime: Date | null | undefined,
  fromTime: Date | null | undefined,
): Promise<Array<{ id: string; workspaceId: string }>> {
  return rawQuery(
    ['Ticket', 'Channel'],
    'admin backfill: vespa reindex page of EMAIL-channel tickets, across every workspace',
    () => db.$queryRaw<{ id: string; workspaceId: string }[]>(Prisma.sql`
      SELECT t.id, t."workspaceId"
      FROM "tickets" t
      JOIN "channels" ch ON ch.id = t."channelId"
      WHERE ch.type = ${ChannelType.EMAIL}::"ChannelType"
      ${cutoffTime && fromTime
        ? Prisma.sql`AND t."updatedAt" >= ${fromTime} AND t."updatedAt" <= ${cutoffTime}`
        : cutoffTime
        ? Prisma.sql`AND t."updatedAt" <= ${cutoffTime}`
        : Prisma.sql``}
      ${cutoffTime
        ? Prisma.sql`ORDER BY t."updatedAt" ASC`
        : Prisma.sql`ORDER BY t."createdAt" ASC`}
      LIMIT ${batchSize}
      OFFSET ${skip};
    `),
  );
}

/**
 * Writes the recomputed participant count and preview payload for one call. SQL unchanged from
 * the original call site.
 */
export function updateCallParticipantCountAndPreview(
  callId: string,
  nextCount: number,
  nextPreviewUserIds: string,
): Promise<number> {
  return rawQuery(
    ['Call'],
    'admin backfill: recompute call participant count/preview, across every workspace',
    () => db.$executeRaw(
      Prisma.sql`
        UPDATE "public"."calls"
        SET
          "participantCount" = ${nextCount},
          "participantPreviewUserIds" = ${nextPreviewUserIds}
        WHERE "id" = ${callId}
      `,
    ),
  );
}

/**
 * Stamps ticket_activities.channelId (from the parent ticket) for rows that predate the column,
 * scoped to email-desk channels only. SQL unchanged from the original call site.
 */
export function deskMetricsBackfillChannelIdBatch(batchSize: number): Promise<number> {
  return rawQuery(
    ['TicketActivity', 'Ticket', 'EmailChannelPreference'],
    'admin backfill: stamp ticket_activities.channelId for pre-existing rows, across every workspace',
    () => db.$executeRaw`
      WITH batch AS (
        SELECT ta.id, t."channelId" AS channel_id
        FROM "public"."ticket_activities" ta
        JOIN "public"."tickets" t ON t.id = ta."ticketId"
        WHERE ta."channelId" IS NULL
          AND t."channelId" IN (
            SELECT "channelId" FROM "public"."email_channel_preferences"
          )
        LIMIT ${batchSize}
      )
      UPDATE "public"."ticket_activities" ta
      SET "channelId" = batch.channel_id
      FROM batch
      WHERE ta.id = batch.id
    `,
  );
}

/**
 * Inserts a synthetic TICKET_CREATED activity for email-desk tickets created within the lookback
 * window that don't already have one. SQL unchanged from the original call site.
 */
export function deskMetricsBackfillTicketCreatedActivityBatch(batchSize: number, cutoff: Date): Promise<number> {
  return rawQuery(
    ['TicketActivity', 'Ticket', 'EmailChannelPreference'],
    'admin backfill: insert synthetic TICKET_CREATED activity rows, across every workspace',
    () => db.$executeRaw`
      WITH batch AS (
        SELECT t.id, t."createdBy", t."createdAt", t."channelId", t."workspaceId", t."priority", t."stageName", t."statusV2"
        FROM "public"."tickets" t
        WHERE t."channelId" IN (
            SELECT "channelId" FROM "public"."email_channel_preferences"
          )
          AND t."createdAt" >= ${cutoff}
          AND NOT EXISTS (
            SELECT 1 FROM "public"."ticket_activities" ta
            WHERE ta."ticketId" = t.id AND ta."activityType" = 'TICKET_CREATED'
          )
        LIMIT ${batchSize}
      )
      INSERT INTO "public"."ticket_activities" (id, "ticketId", "updatedBy", timestamp, "activityType", "channelId", "workspaceId", value)
      SELECT
        gen_random_uuid()::text,
        b.id,
        b."createdBy",
        b."createdAt",
        'TICKET_CREATED',
        b."channelId",
        b."workspaceId",
        jsonb_build_object('field', 'ticketCreated', 'priority', b."priority"::text, 'stageName', b."stageName", 'statusV2', b."statusV2"::text)
      FROM batch b
    `,
  );
}
