import { Prisma, type PrismaClient } from '@prisma/client';
import { AttachmentEntityType } from '@xyne/shared';
import { rawQuery } from './base';
import type { FilteredMessage } from '@/database/repositories/analyticsRepository';

type AnalyticsClient = PrismaClient | Prisma.TransactionClient;

/**
 * Relocated from database/repositories/analyticsRepository's chatAttachmentsFrom. A shared FROM +
 * WHERE fragment for chat attachments; only ever composed into the raw statements below, so it
 * lives with them. Predicates unchanged, including the explicit workspace predicate.
 */
export function chatAttachmentsFrom(messageIds: string[], workspaceId: string): Prisma.Sql {
  return Prisma.sql`
      FROM "public"."message_attachments" a
      WHERE a."entityId" = ANY(${messageIds}::text[])
        AND a."entityType" = ${AttachmentEntityType.CHAT}
        AND a."workspaceId" = ${workspaceId}
        AND a."createdBy" NOT IN ('Unified Alerts', 'system')
    `;
}

/** Relocated from analyticsRepository's file-attachment time series. SQL unchanged. */
export async function queryChatAttachmentCreatedAt(client: AnalyticsClient, validMessageIds: string[], workspaceId: string): Promise<Array<{ createdAt: Date }>> {
  return rawQuery(
    ['MessageAttachment'],
    'analytics: chat attachment time series, workspace predicate written explicitly in the SQL',
    () => client.$queryRaw<{ createdAt: Date }[]>(Prisma.sql`
      SELECT a."createdAt"
      ${chatAttachmentsFrom(validMessageIds, workspaceId)}
    `),
  );
}

/** Relocated from analyticsRepository's attachment count. SQL unchanged. */
export async function countChatAttachments(client: AnalyticsClient, validMessageIds: string[], workspaceId: string): Promise<Array<{ count: number }>> {
  return rawQuery(
    ['MessageAttachment'],
    'analytics: chat attachment count, workspace predicate written explicitly in the SQL',
    () => client.$queryRaw<{ count: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS count
      ${chatAttachmentsFrom(validMessageIds, workspaceId)}
    `),
  );
}

/**
 * Relocated from analyticsRepository's queryFilteredMessages. The date bounds arrive as
 * pre-built fragments because emitting them as plain comparisons (rather than an
 * `IS NULL OR ...` form) is what keeps the plan sargable. SQL unchanged.
 */
export async function queryFilteredMessages(client: AnalyticsClient, gteClause: Prisma.Sql, lteClause: Prisma.Sql, scopedWorkspaceId: string, excludedChannels: readonly string[]): Promise<FilteredMessage[]> {
  return rawQuery(
    ['Message', 'Conversation', 'Channel', 'ExternalSource'],
    'analytics: message roll-up across a workspace, workspace predicate written explicitly in the SQL',
    () => client.$queryRaw<FilteredMessage[]>(Prisma.sql`
      SELECT 
        m."messageId", 
        m."senderId", 
        m."conversationId", 
        c."channelId",
        ch."scopeType" AS "channelScopeType",
        m."createdAt"
      FROM "public"."messages_without_content" m
      INNER JOIN "public"."conversations" c 
        ON c."conversationId" = m."conversationId"
      INNER JOIN "public"."channels" ch
        ON ch."id" = c."channelId"
      WHERE 
        m."msgType" = 'USER'
        ${gteClause}
        ${lteClause}
        AND ch."workspaceId" = ${scopedWorkspaceId}
        AND c."channelId" NOT IN (${Prisma.join(excludedChannels)})
        AND NOT EXISTS (
          SELECT 1 
          FROM "workflow"."external_sources" es
          WHERE es."channelId" = c."channelId"
            AND m."createdAt" < es."createdAt"
        )
        AND NOT (
          ch."type" = 'EMAIL'
          AND (c."parentMessageId" IS NULL OR m."messageId" = c."initialMessageId")
        )
    `),
  );
}
