/**
 * Get Page Content Tool
 *
 * Retrieves the exact text content of specific pages from a file document.
 * Uses chunks_map to map page numbers to chunk indices, then returns the
 * relevant chunks.
 */

import { z } from 'zod';
import { type Tool } from '@juspay-jaf/jaf';
import { db } from '../../../database/client.js';
import vespaClient from '../../../vespa/client/index.js';
import { fileSchema } from '../../../vespa/src/types.js';
import { logger } from '../../../utils/logger.js';
import type { VespaFileDocument, VespaChunkMeta } from '../../../vespa/src/types.js';
import type { XyneAIAgentContext, EnhancedToolResult, ToolEntity, EntityType } from './types.js';
import {
  getDescription,
  toIST,
  getNextPrefix,
  appendEnhancedSessionMappings,
  buildEnhancedCitationMappings,
  formatEnhancedToolResultForContext,
} from './helpers.js';

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create get_page_content tool — retrieves exact page content from a file
 * using chunks_map to locate the right chunks by page number.
 */
export function createGetPageContentTool(): Tool<
  {
    docId: string;
    pageNos: number[];
    includeImages?: boolean;
  },
  XyneAIAgentContext
> {
  return {
    schema: {
      name: 'get_page_content',
      description: getDescription('get_page_content'),
      parameters: z.object({
        docId: z
          .string()
          .min(1)
          .describe(
            'The Vespa document ID of the file to retrieve pages from. Use the "doc_id" value shown in search_files results (e.g. "clf-abc123...").',
          ),
        pageNos: z
          .array(z.number().int().min(1))
          .min(1)
          .max(5)
          .describe(
            'Array of 1-based page numbers to retrieve (e.g. [5] for page 5, or [5, 6, 7] for pages 5-7). Maximum 5 pages per call.',
          ),
        includeImages: z
          .boolean()
          .optional()
          .describe(
            'Whether to include image descriptions found on the requested pages. Defaults to true.',
          ),
      }),
    },
    execute: async (args, context) => {
      const { docId, pageNos, includeImages = true } = args;
      const { sessionId } = context;

      logger.info(
        `[Tool] [${sessionId}] get_page_content: docId="${docId}", pages=${JSON.stringify(pageNos)}`,
      );

      try {
        // Fetch the full document from Vespa by ID
        const rawDoc = await vespaClient.crudService.getDocument(docId, fileSchema);

        if (!rawDoc || !(rawDoc as any).fields) {
          return `Could not find document with ID "${docId}". Make sure you are using the docId returned by search_files.`;
        }

        const fields = (rawDoc as any).fields as VespaFileDocument;

        const chunks: string[] = fields.chunks || [];
        const imageChunks: string[] = fields.image_chunks || [];
        const chunksMap: VespaChunkMeta[] = fields.chunks_map || [];
        const imageChunksMap: VespaChunkMeta[] = fields.image_chunks_map || [];

        if (chunks.length === 0) {
          return `Document "${docId}" has no text content.`;
        }

        if (chunksMap.length === 0) {
          return `Document "${docId}" does not have page mapping (chunks_map). Page-level retrieval is not supported for this file.`;
        }

        // Convert 1-based page numbers to 0-indexed
        const targetPageIndices = pageNos.map((p) => p - 1);

        // Find all chunk indices that belong to the requested pages
        const pageChunkIndices = [
          ...new Set(
            chunksMap
              .filter(
                (meta) =>
                  meta.page_numbers &&
                  targetPageIndices.some((p) => meta.page_numbers.includes(p)),
              )
              .map((meta) => meta.chunk_index),
          ),
        ].sort((a, b) => a - b);

        // Find image chunk indices for the requested pages
        const pageImageChunkIndices = includeImages
          ? [
              ...new Set(
                imageChunksMap
                  .filter(
                    (meta) =>
                      meta.page_numbers &&
                      targetPageIndices.some((p) => meta.page_numbers.includes(p)),
                  )
                  .map((meta) => meta.chunk_index),
              ),
            ].sort((a, b) => a - b)
          : [];

        if (pageChunkIndices.length === 0 && pageImageChunkIndices.length === 0) {
          return `Pages [${pageNos.join(', ')}] not found or empty in document "${docId}". The document may have fewer pages than requested.`;
        }

        const entities: ToolEntity[] = [];
        let entityCounter = 0;

        let parsedMetadata: Record<string, any> = {};
        try {
          if (fields.metadata) parsedMetadata = JSON.parse(fields.metadata);
        } catch { /* ignore */ }

        const subApp = (fields.subApp || '').toLowerCase();
        let entityType: EntityType;
        let canvasId: string | undefined;
        let callId: string | undefined;
        switch (subApp) {
          case 'canvas':
            entityType = 'canvas';
            canvasId = fields.docId;
            break;
          case 'transcript':
            entityType = 'call';
            callId = parsedMetadata.callId || fields.docId;
            break;
          case 'rca':
            entityType = 'ticket';
            break;
          case 'chat_attachment':
          default:
            entityType = 'attachment';
            break;
        }

        const docChannelId = (fields as any).channelId || '';
        let channelName = '';
        if (docChannelId) {
          const channel = await db.channel.findFirst({ where: { id: docChannelId }, select: { name: true } });
          if (channel) channelName = channel.name;
        }

        const ownerId = fields.ownerId;
        let authorName = 'Unknown';
        if (ownerId) {
          const user = await db.user.findFirst({ where: { id: ownerId }, select: { name: true, email: true } });
          if (user) authorName = user.name || user.email || 'Unknown';
        }

        const conversationId = fields.conversationId || parsedMetadata.conversationId || undefined;
        const timestamp = fields.createdAt ? toIST(new Date(fields.createdAt)) : '';
        const createdAtStr = typeof fields.createdAt === 'number' && isFinite(fields.createdAt)
          ? new Date(fields.createdAt).toISOString()
          : '';
        const updatedAtStr = typeof fields.updatedAt === 'number' && isFinite(fields.updatedAt)
          ? new Date(fields.updatedAt).toISOString()
          : '';
        const docMeta = [
          `doc_id: ${fields.docId}`,
          `File: ${fields.fileName || 'Untitled'}`,
          `SubApp: ${fields.subApp || 'unknown'}`,
          `Mime Type: ${fields.mimeType || 'N/A'}`,
          createdAtStr ? `Created: ${createdAtStr}` : '',
          updatedAtStr ? `Updated: ${updatedAtStr}` : '',
        ].filter(Boolean).join('\n');

        const baseFields = {
          entityType,
          entityId: fields.docId,
          authorName,
          authorId: fields.ownerId,
          timestamp,
          channelId: docChannelId,
          channelName,
          conversationId,
          canvasId,
          callId,
          fileName: fields.fileName,
          attachmentMimetype: fields.mimeType,
        };

        const chunksPos = ((fields as any).chunks_pos_summary as unknown as Array<string | number>)
          ?? ((fields as any).chunks_pos as unknown as Array<string | number>)
          ?? [];

        for (const idx of pageChunkIndices) {
          if (idx < chunks.length) {
            let text = chunks[idx];
            const pageMatch = text.match(/^\[Pages?\s+(\d+)/i);
            text = text.replace(/^\[Pages?\s+\d+(?:[-,\s\d]*)?\]\s*/i, '');
            const chunkPosFromText = pageMatch?.[1] ? Number(pageMatch[1]) : undefined;
            entityCounter++;
            entities.push({
              ...baseFields,
              entityIndex: entityCounter,
              content: `${docMeta}\nContent: ${text}`,
              chunkIndex: idx,
              chunkText: text,
              chunkPos:
                chunkPosFromText
                ?? chunksMap[idx]?.page_numbers?.[0]
                ?? (chunksPos.length > idx ? Number(chunksPos[idx]) : undefined),
            } as ToolEntity);
          }
        }

        if (includeImages && pageImageChunkIndices.length > 0) {
          const imageChunksPos = ((fields as any).image_chunks_pos as unknown as Array<string | number>) ?? [];
          for (const idx of pageImageChunkIndices) {
            if (idx < imageChunks.length) {
              entityCounter++;
              entities.push({
                ...baseFields,
                entityIndex: entityCounter,
                content: `${docMeta}\nContent: [Image Description: ${imageChunks[idx]}]`,
                chunkIndex: idx,
                chunkText: `${fields.docId}_${imageChunksPos[idx] ?? idx}`,
                chunkPos: imageChunksMap[idx]?.page_numbers?.[0] ?? (imageChunksPos.length > idx ? Number(imageChunksPos[idx]) : undefined),
              } as ToolEntity);
            }
          }
        }

        const result: EnhancedToolResult = {
          success: true,
          entities,
          metadata: {
            totalCount: entities.length,
            messageCount: 0,
            attachmentCount: entities.filter(e => e.entityType === 'attachment').length,
            callCount: entities.filter(e => e.entityType === 'call').length,
            canvasCount: entities.filter(e => e.entityType === 'canvas').length,
            ticketCount: entities.filter(e => e.entityType === 'ticket').length,
          },
        };

        const prefix = await getNextPrefix(context.sessionId);
        if (result.success && result.entities.length > 0) {
          const citationMappings = buildEnhancedCitationMappings(result);
          await appendEnhancedSessionMappings(context.sessionId, citationMappings, prefix);
        }

        const toolOutput = formatEnhancedToolResultForContext(result, prefix);

        logger.info(
          `[Tool] [${sessionId}] get_page_content: Returned ${pageChunkIndices.length} text chunks and ${pageImageChunkIndices.length} image chunks for doc "${docId}"`,
        );

        return toolOutput;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error(`[Tool] [${sessionId}] get_page_content error:`, error);
        return `Error retrieving page content from document "${docId}": ${errMsg}`;
      }
    },
  };
}

export function getGetPageContentTool() {
  return createGetPageContentTool();
}
