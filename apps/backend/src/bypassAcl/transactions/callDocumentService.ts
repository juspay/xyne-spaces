import { CanvasVisibility, CallOrigin, CanvasRole } from '@xyne/shared';
import {  INITIAL_DETAILED_SUMMARY_CANVAS_VERSION } from '@/services/callDocumentService';
import { newConnectId, createConnectGroupForEntity, resolveCanvasConnectId, ConnectEntityType } from '@/database/connectGroup';
import { PrismaClient } from '@prisma/client';
import { transaction, type TableName } from '../base';
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@prisma/client';

/**
 * Serializable transaction retried on a write conflict (P2034), same pattern as the sharing
 * services. Private so only the named operations in this file use it, each passing its own tables.
 */
async function runTransaction<T>(
  prisma: PrismaClient,
  tables: TableName[],
  reason: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await transaction(tables, reason, prisma, operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const isWriteConflict = (error as { code?: string } | null)?.code === 'P2034';
      if (!isWriteConflict || attempt === 3) throw error;
    }
  }
  throw new Error('Call message metadata transaction retry limit exceeded');
}

export function updateCallMessageMetadataTx(prisma: PrismaClient, callMessage: any, canvasUrl: string | null, metadataKey: string) {
  // Title generation and first-chunk Canvas publication can update this message concurrently.
  // Serializable + retry so the merge always starts from the latest metadata and neither write
  // erases the other's key. No raw SQL / FOR UPDATE needed.
  return runTransaction(prisma, ['Message'], 'updateCallMessageMetadata: message metadata merge and update must commit atomically; tx is not ACL-wrapped', async (tx) => {
      const lockedMessage = await tx.message.findUnique({
        where: { messageId: callMessage.messageId },
        select: { metadata: true },
      });
      if (!lockedMessage) {
        return;
      }

      // Set the canvas URL, or drop the key entirely when clearing (null).
      const currentMetadata = (lockedMessage.metadata as Record<string, any>) || {};
      const nextMetadata = { ...currentMetadata };
      if (canvasUrl === null) {
        delete nextMetadata[metadataKey];
      } else {
        nextMetadata[metadataKey] = canvasUrl;
      }
      await tx.message.update({
        where: { messageId: callMessage.messageId },
        data: { metadata: nextMetadata },
      });
    });
}

export async function createPRDCanvasTx(prisma: PrismaClient, canvasId: string, title: string, channelId: string, workspaceId: string, createdByUserId: string, now: Date, callId: string, conversationId: string, accessMode: string, callCreatorUserId: string) {
  const result = await transaction(['Call', 'CallParticipant', 'Canvas', 'CanvasParticipant', 'ConnectGroup'], 'createPRDCanvas: PRD canvas creation and call access grants must commit atomically; tx is not ACL-wrapped', prisma, async (tx) => {
    // Keep PRD canvases private and grant the same explicit access as
    // detailed-summary canvases generated from this call.
    // Slack Connect: a canvas is a shareable entity → its own connectId + a private connect_group row.
    const connectId = newConnectId();
    await tx.canvas.create({
      data: {
        id: canvasId,
        title,
        content: [],
        channelId,
        workspaceId,
        createdBy: createdByUserId,
        visibility: CanvasVisibility.PRIVATE,
        isTemplate: false,
        isCollaborative: true,
        lastEditedBy: createdByUserId,
        lastEditedAt: now,
        createdAt: now,
        updatedAt: now,
        connectId,
        metadata: {
          source: 'call_prd',
          callId,
          conversationId,
          generatedAt: now.toISOString(),
        },
      },
    });
    await createConnectGroupForEntity(tx, {
      entityType: ConnectEntityType.CANVAS,
      entityId: canvasId,
      hostWorkspaceId: workspaceId,
      connectId,
    });
    accessMode = await createCallCanvasAccess(tx, {
      canvasId,
      workspaceId,
      callId,
      createdByUserId,
      callCreatorUserId,
      channelId,
      now,
    });
  });
  return { result, accessMode };
}

export async function createDetailedSummaryCanvasTx(prisma: PrismaClient, canvasId: string, title: string, channelId: string | null, workspaceId: string, createdByUserId: string, now: Date, callId: string, conversationId: string | null, mentionedUserIds: string[], options: { deferInsertSideEffects?: boolean; summaryModelPreference?: "fast" | "thinking"; isRecording?: boolean; }, accessMode: string, callCreatorUserId: string) {
  const result = await transaction(['Call', 'CallParticipant', 'Canvas', 'CanvasParticipant', 'ConnectGroup'], 'createDetailedSummaryCanvas: summary canvas creation and call access grants must commit atomically; tx is not ACL-wrapped', prisma, async (tx) => {
    // Slack Connect: a canvas is a shareable entity → its own connectId + a private connect_group row.
    const connectId = newConnectId();
    await tx.canvas.create({
      data: {
        id: canvasId,
        title,
        content: [],
        channelId,
        workspaceId,
        createdBy: createdByUserId,
        visibility: CanvasVisibility.PRIVATE,
        isTemplate: false,
        isCollaborative: true,
        lastEditedBy: createdByUserId,
        lastEditedAt: now,
        createdAt: now,
        updatedAt: now,
        connectId,
        metadata: {
          source: 'call_detailed_summary',
          callId,
          conversationId,
          isRecording: options.isRecording === true,
          isAiGenerated: true,
          generatedAt: now.toISOString(),
          mentionedUserIds, // Store mentioned users for side effect handler
          version: INITIAL_DETAILED_SUMMARY_CANVAS_VERSION,
          // Recording summary LLM tier the client carried from its
          // localStorage at recording start; read back on the headless
          // call-end path (see noteTakerTranscriptService.getSummaryModelPreference).
          ...(options.summaryModelPreference
            ? { summaryModelPreference: options.summaryModelPreference }
            : {}),
        },
      },
    });
    await createConnectGroupForEntity(tx, {
      entityType: ConnectEntityType.CANVAS,
      entityId: canvasId,
      hostWorkspaceId: workspaceId,
      connectId,
    });

    accessMode = await createCallCanvasAccess(tx, {
      canvasId,
      workspaceId,
      callId,
      createdByUserId,
      callCreatorUserId,
      channelId,
      now,
    });
  });
  return { result, accessMode };
}

  /**
   * Grant the standard access policy for a canvas generated from a call.
   */
export async function createCallCanvasAccess(tx: Prisma.TransactionClient, params: {
      canvasId: string;
      workspaceId: string;
      callId: string;
      createdByUserId: string;
      callCreatorUserId: string;
      channelId: string | null;
      now: Date;
    }): Promise<string> {
    const { canvasId, workspaceId, callId, createdByUserId, callCreatorUserId, channelId, now } = params;
    const call = await tx.call.findUnique({
      where: { externalId: callId },
      select: { id: true, callOrigin: true },
    });
    const isChannelThreadCall = call?.callOrigin === CallOrigin.CONVERSATION && channelId !== null;

    // Slack Connect: participants inherit the parent canvas's connectId (null until backfilled).
    const connectId = await resolveCanvasConnectId(tx, canvasId);

    await tx.canvasParticipant.create({
      data: {
        id: uuidv4(), canvasId, workspaceId, userId: createdByUserId, role: CanvasRole.OWNER,
        joinedAt: now, updatedAt: now, ...(connectId ? { canvasConnectId: connectId } : {}),
      },
    });
    await tx.canvasParticipant.create({
      data: {
        id: uuidv4(), canvasId, workspaceId, userId: callCreatorUserId, role: CanvasRole.OWNER,
        joinedAt: now, updatedAt: now, ...(connectId ? { canvasConnectId: connectId } : {}),
      },
    });

    if (isChannelThreadCall && call) {
      const callParticipants = await tx.callParticipant.findMany({
        where: { callId: call.id, isExternal: false },
        select: { userId: true },
      });
      const editorUserIds = [...new Set(callParticipants.map(({ userId }) => userId))]
        .filter((userId) => userId !== createdByUserId && userId !== callCreatorUserId);
      if (editorUserIds.length > 0) {
        await tx.canvasParticipant.createMany({
          data: editorUserIds.map((userId) => ({
            id: uuidv4(), canvasId, workspaceId, userId, role: CanvasRole.EDITOR,
            joinedAt: now, updatedAt: now, ...(connectId ? { canvasConnectId: connectId } : {}),
          })),
        });
      }
    }

    if (channelId) {
      await tx.canvasParticipant.create({
        data: {
          id: uuidv4(), canvasId, workspaceId, channelId,
          role: isChannelThreadCall ? CanvasRole.VIEWER : CanvasRole.EDITOR,
          joinedAt: now, updatedAt: now, ...(connectId ? { canvasConnectId: connectId } : {}),
        },
      });
    }

    if (isChannelThreadCall) return 'thread participants as editors and channel as viewer';
    return channelId ? 'channel as editor' : 'private access';
  }
