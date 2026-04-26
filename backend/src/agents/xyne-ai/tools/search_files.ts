/**
 * Search Files Tool
 * Semantic + lexical search over files indexed in Vespa (canvases, transcripts, RCAs)
 * Returns relevant chunks from matched documents.
 */

import { z } from 'zod';
import { type Tool } from '@juspay-jaf/jaf';
import { db } from '../../../database/client.js';
import { logger } from '../../../utils/logger.js';
import { vespaService } from '../../../services/vespaSearch/index.js';
import type { FileFilters } from '../../../vespa/src/utils/YqlBuilder.js';
import type { VespaChunkMeta, VespaFileSearchDocument, VespaSearchHit } from '../../../vespa/src/types.js';
import type { XyneAIAgentContext, EnhancedToolResult, ToolEntity, EntityType } from './types.js';
import {
  getDescription,
  toIST,
  resolveChannelNames,
  resolveUserName,
  getNextPrefix,
  appendEnhancedSessionMappings,
  buildEnhancedCitationMappings,
  formatEnhancedToolResultForContext,
} from './helpers.js';
import { askAIFileSearchUsedTotal } from '../../../services/otel/aiMetrics.js';

// ============================================================================
// Constants
// ============================================================================

/** Maximum number of chunks to extract per document */
const MAX_CHUNKS_PER_DOC = 6;

/** Maximum number of Vespa results to request */
const VESPA_RESULT_LIMIT = 15;

// ============================================================================
// Chunk Scoring
// ============================================================================

interface ScoredChunk {
  chunk: string;
  score: number;
  index: number;
}

/**
 * Scale raw Vespa chunk score to 0-1 range using arctan normalization.
 */
function scale(val: number): number | null {
  if (!val) return null;
  return (2 * Math.atan(val / 4)) / Math.PI;
}

/**
 * Extract and rank the best text chunks from a Vespa hit using
 * matchfeatures chunk_scores. Returns top-N chunks sorted by
 * descending relevance.
 */
function getSortedScoredChunks(
  matchfeatures: Record<string, any> | undefined,
  existingChunksSummary: string[],
  maxChunks?: number,
): ScoredChunk[] {


  if (!existingChunksSummary?.length) {
    return [];
  }

  if (
    !matchfeatures?.chunk_scores?.cells ||
    !Object.keys(matchfeatures.chunk_scores.cells).length
  ) {
    const mappedChunks = existingChunksSummary.map((v, index) => ({
      chunk: v,
      score: 0,
      index,
    }));
    return maxChunks ? mappedChunks.slice(0, maxChunks) : mappedChunks;
  }

  const chunkScores = matchfeatures.chunk_scores.cells;

  const chunksWithIndices = existingChunksSummary.map((chunk, index) => ({
    index,
    chunk,
    score: scale(Number(chunkScores[index]) || 0) || 0,
  }));

  const filteredChunks = chunksWithIndices.filter(
    ({ index }) => index in chunkScores,
  );

  const sortedChunks = filteredChunks.sort((a, b) => b.score - a.score);

  return maxChunks ? sortedChunks.slice(0, maxChunks) : sortedChunks;
}

/**
 * Extract and rank the best image chunks from a Vespa hit using
 * matchfeatures image_chunk_scores. Produces chunk names as
 * `${docId}_${position}`.
 */
function getSortedScoredImageChunks(
  matchfeatures: Record<string, any> | undefined,
  existingImageChunksPosSummary: number[],
  existingImageChunksSummary: string[],
  docId: string,
  maxChunks?: number,
): ScoredChunk[] {
  if (!existingImageChunksSummary?.length) {
    return [];
  }

  const imageChunksPos = existingImageChunksPosSummary;
  const imageChunkScores =
    matchfeatures &&
    'image_chunk_scores' in matchfeatures &&
    'cells' in matchfeatures.image_chunk_scores
      ? matchfeatures.image_chunk_scores.cells
      : {};

  const imageChunksWithIndices = existingImageChunksSummary.map((_chunk, index) => ({
    index,
    chunk: `${docId}_${imageChunksPos[index] ?? index}`,
    score: scale(imageChunkScores[index] ?? 0) || 0,
  }));

  const filteredImageChunks = imageChunksWithIndices.filter(
    ({ index }) => index < imageChunksPos.length,
  );

  const sortedImageChunks = filteredImageChunks.sort((a, b) => b.score - a.score);

  return maxChunks ? sortedImageChunks.slice(0, maxChunks) : sortedImageChunks;
}

// ============================================================================
// Formatting Helpers
// ============================================================================

/**
 * Convert epoch timestamp (ms) to human-readable relative time string
 */
function getRelativeTime(epochMs: number): string {
  const now = Date.now();
  const diffMs = now - epochMs;

  if (diffMs < 0) return 'just now';

  const minutes = Math.floor(diffMs / (1000 * 60));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days > 1 ? 's' : ''} ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months > 1 ? 's' : ''} ago`;

  const years = Math.floor(months / 12);
  return `${years} year${years > 1 ? 's' : ''} ago`;
}

/**
 * Format a single file document result with its best chunks.
 * Scores and ranks text/image chunks using matchfeatures, returns the ranked
 * chunk array (for per-chunk entity expansion) and a fallback content string
 * (used when there are no chunks).
 */
function formatFileDocContext(
  fields: VespaFileSearchDocument,
  matchfeatures: Record<string, any> | undefined,
  maxSummaryChunks: number = MAX_CHUNKS_PER_DOC,
): { contentString: string; scoredChunks: ScoredChunk[] } {
  // ── Score and select text chunks ─────────────────────────────────────
  let chunks: ScoredChunk[] = [];
  if (matchfeatures && fields.chunks?.length) {
    const summaryStrings = fields.chunks.map((c: any) =>
      typeof c === 'string' ? c : c.chunk,
    );
    chunks = getSortedScoredChunks(matchfeatures, summaryStrings, maxSummaryChunks);
  } else if (fields.chunks?.length) {
    chunks = fields.chunks.slice(0, maxSummaryChunks).map((chunk: any, idx: number) => ({
      chunk: typeof chunk === 'string' ? chunk : chunk.chunk,
      index: idx,
      score: 0,
    }));
  }

  // ── Score and select image chunks ────────────────────────────────────
  const maxImageChunks = Math.min(fields.image_chunks?.length || 0, 5);
  let imageContent = '';
  if (fields.image_chunks?.length) {
    const imageChunksPos = (fields.image_chunks_pos as unknown as number[]) || [];
    let imageChunks: ScoredChunk[];
    if (matchfeatures) {
      const summaryStrings = fields.image_chunks.map((c: any) =>
        typeof c === 'string' ? c : c.chunk,
      );
      imageChunks = getSortedScoredImageChunks(
        matchfeatures,
        imageChunksPos,
        summaryStrings,
        fields.docId,
        maxImageChunks,
      );
    } else {
      imageChunks = fields.image_chunks.slice(0, maxImageChunks).map((_: any, idx: number) => ({
        chunk: `${fields.docId}_${imageChunksPos[idx] ?? idx}`,
        index: idx,
        score: 0,
      }));
    }
    imageContent = imageChunks.map((v) => v.chunk).join('\n');
  }

  // ── Build fallback context string (used only when scoredChunks is empty) ─
  const parts: string[] = [
    `SubApp: ${fields.subApp || 'unknown'}`,
    `File: ${fields.fileName || 'Untitled'}`,
    `Mime Type: ${fields.mimeType || 'N/A'}`,
  ];
  if (fields.fileSize) parts.push(`File Size: ${fields.fileSize} bytes`);
  if (typeof fields.createdAt === 'number' && isFinite(fields.createdAt))
    parts.push(`Created: ${getRelativeTime(fields.createdAt)}`);
  if (typeof fields.updatedAt === 'number' && isFinite(fields.updatedAt))
    parts.push(`Updated: ${getRelativeTime(fields.updatedAt)}`);
  if (fields.ownerId) parts.push(`Owner ID: ${fields.ownerId}`);
  const textContent = chunks.map((v) => v.chunk).join('\n');
  if (textContent) parts.push(`Content: ${textContent}`);
  if (imageContent) parts.push(`Image File Names: ${imageContent}`);

  return {
    contentString: parts.join('\n'),
    scoredChunks: chunks,
  };
}

// ============================================================================
// Core Search Implementation
// ============================================================================

/**
 * Search files in Vespa and return ranked, chunk-extracted results
 */
export async function searchFilesImpl(
  query: string,
  userId: string,
  sessionId: string,
  fileFilters: Partial<FileFilters>,
): Promise<EnhancedToolResult> {
  try {
    logger.info(
      `[Tool] [${sessionId}] search_files: query="${query}", filters=${JSON.stringify(fileFilters)}`,
    );

    const vespaOptions = {
      offset: 0,
      limit: VESPA_RESULT_LIMIT,
      rankProfile: 'default_native',
      file: fileFilters as FileFilters,
    };

    const vespaResults = await vespaService.searchService.searchVespa(
      query,
      userId,
      ['file'],
      vespaOptions,
    );

    const hits: VespaSearchHit[] = vespaResults.root.children || [];
    logger.info(`[Tool] [${sessionId}] search_files: Vespa returned ${hits.length} raw hits`);

    if (hits.length === 0) {
      return {
        success: true,
        entities: [],
        metadata: {
          totalCount: 0,
          messageCount: 0,
          attachmentCount: 0,
          callCount: 0,
          canvasCount: 0,
          ticketCount: 0,
        },
      };
    }
    // Resolve owner IDs to names
    const ownerIds = [...new Set(hits.map(h => (h.fields as VespaFileSearchDocument).ownerId).filter(Boolean))];
    const users = await db.user.findMany({
      where: { id: { in: ownerIds } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map(u => [u.id, { name: u.name, email: u.email }]));

    // Resolve channelRef IDs to channel names
    const allChannelIds = [...new Set(
      hits
        .map(h => (h.fields as any).channelId)
        .filter((ref): ref is string => !!ref),
    )];
    let channelNameMap = new Map<string, string>();
    if (allChannelIds.length > 0) {
      const channels = await db.channel.findMany({
        where: { id: { in: allChannelIds } },
        select: { id: true, name: true },
      });
      channelNameMap = new Map(channels.map(c => [c.id, c.name]));
    }

    // Transform each hit into one ToolEntity per scored chunk so the LLM can
    // cite a specific chunk within a document (not just the top chunk).
    // Sort by most recently updated/created first so when multiple versions of
    // the same file exist, the newest one appears first and the LLM uses it.
    const sortedHits = [...hits].sort((a, b) => {
      const aTime = (a.fields as any).updatedAt ?? (a.fields as any).createdAt ?? 0;
      const bTime = (b.fields as any).updatedAt ?? (b.fields as any).createdAt ?? 0;
      return bTime - aTime;
    });
    let entityCounter = 0;
    const entities: ToolEntity[] = sortedHits.flatMap((hit) => {
      const doc = hit.fields as VespaFileSearchDocument;
      const owner = userMap.get(doc.ownerId);
      const { scoredChunks, contentString: baseContent } = formatFileDocContext(
        doc,
        doc.matchfeatures,
      );

      const docChannelId = (doc as any).channelId || '';
      const channelName = channelNameMap.get(docChannelId) || '';

      let parsedMetadata: Record<string, any> = {};
      try {
        if (doc.metadata) parsedMetadata = JSON.parse(doc.metadata);
      } catch { /* ignore */ }

      const subApp = (doc.subApp || '').toLowerCase();
      let entityType: EntityType;
      let canvasId: string | undefined;
      let callId: string | undefined;
      switch (subApp) {
        case 'canvas':
          entityType = 'canvas';
          canvasId = parsedMetadata.viewAccessId || doc.docId;
          break;
        case 'transcript':
          entityType = 'call';
          callId = parsedMetadata.callId || doc.docId;
          break;
        case 'rca':
          entityType = 'ticket';
          break;
        case 'chat_attachment':
        default:
          entityType = 'attachment';
          break;
      }

      const conversationId = doc.conversationId || parsedMetadata.conversationId || undefined;
      const authorName = owner?.name || owner?.email || 'Unknown';
      const timestamp = doc.createdAt ? toIST(new Date(doc.createdAt)) : '';
      const createdAtStr = typeof doc.createdAt === 'number' && isFinite(doc.createdAt)
        ? new Date(doc.createdAt).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
        : '';
      const updatedAtStr = typeof doc.updatedAt === 'number' && isFinite(doc.updatedAt)
        ? new Date(doc.updatedAt).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
        : '';
      const docMeta = [
        `doc_id: ${doc.docId}`,
        `File: ${doc.fileName || 'Untitled'}`,
        `SubApp: ${doc.subApp || 'unknown'}`,
        `Mime Type: ${doc.mimeType || 'N/A'}`,
        createdAtStr ? `Created: ${createdAtStr}` : '',
        updatedAtStr ? `Updated: ${updatedAtStr}` : '',
      ].filter(Boolean).join('\n');

      // Helper: resolve page number for a given chunk index
      const chunksMapSummary = doc.chunks_map_summary as VespaChunkMeta[] | undefined;
      const chunksPos = (doc.chunks_pos_summary as unknown as Array<string | number>)
        ?? (doc.chunks_pos as unknown as Array<string | number>)
        ?? [];
      const resolveChunkPos = (chunkIdx: number): number | undefined => {
        const meta = chunksMapSummary?.[chunkIdx];
        if (meta?.page_numbers?.length) return meta.page_numbers[0];
        return chunksPos.length > chunkIdx ? Number(chunksPos[chunkIdx]) : undefined;
      };

      // Shared base fields for every entity from this doc
      const baseFields = {
        entityType,
        entityId: doc.docId,
        authorName,
        authorId: doc.ownerId,
        timestamp,
        channelId: docChannelId,
        channelName,
        conversationId,
        canvasId,
        callId,
        fileName: doc.fileName,
        attachmentMimetype: doc.mimeType,
      };

      if (scoredChunks.length === 0) {
        entityCounter++;
        return [{ ...baseFields, entityIndex: entityCounter, content: baseContent, chunkIndex: undefined, chunkText: undefined, chunkPos: undefined } as ToolEntity];
      }

      return scoredChunks.map((sc) => {
        entityCounter++;
        const words = sc.chunk.split(/\s+/);
        const truncatedChunk = words.length > 2000 ? words.slice(0, 2000).join(' ') : sc.chunk;
        return {
          ...baseFields,
          entityIndex: entityCounter,
          content: `${docMeta}\nContent: ${truncatedChunk}`,
          chunkIndex: sc.index,
          chunkText: truncatedChunk,
          chunkPos: resolveChunkPos(sc.index),
        } as ToolEntity;
      });
    });

    logger.info(`[Tool] [${sessionId}] search_files: Returning ${entities.length} file results`);

    return {
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
  } catch (error) {
    logger.error(`[Tool] [${sessionId}] search_files error:`, error);
    return {
      success: false,
      entities: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}


// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create search_files tool for semantic + lexical search over indexed files
 */
export function createSearchFilesTool(): Tool<
  {
    query: string;
    channels?: string[];
    file_type?: string;
    created_by?: string;
    createdBefore?: string;
    createdAfter?: string;
    createdOn?: string;
  },
  XyneAIAgentContext
> {
  return {
    schema: {
      name: 'search_files',
      description: getDescription('search_files'),
      parameters: z.object({
        query: z.string().min(1,'Search query cannot be empty').describe('The search query to find relevant file content (canvases, transcripts, RCAs, and attachments)'),
        channels: z
          .array(z.string())
          .optional()
          .describe('Optional list of channel names to scope the file search to'),
        file_type: z
          .enum(['CANVAS', 'TRANSCRIPT', 'RCA', 'CHAT_ATTACHMENT'])
          .optional()
          .describe(
            'Filter by file type. Valid values: "CANVAS" (canvas documents), "TRANSCRIPT" (call transcripts), "RCA" (root cause analysis docs), "CHAT_ATTACHMENT" (file attachments shared in channels). Leave empty to search all types.',
          ),
        created_by: z
          .string()
          .optional()
          .describe(
            'Filter by creator username. Must be validated via field_value_discovery first.',
          ),
        createdBefore: z
          .string()
          .optional()
          .describe('Filter files created before this date (ISO format or dd/mm/yyyy)'),
        createdAfter: z
          .string()
          .optional()
          .describe('Filter files created after this date (ISO format or dd/mm/yyyy)'),
        createdOn: z
          .string()
          .optional()
          .describe('Filter files created on this specific date (ISO format or dd/mm/yyyy)'),
      }),
    },
    execute: async (args, context) => {
      const {
        query,
        channels,
        file_type,
        created_by,
        createdBefore,
        createdAfter,
        createdOn,
      } = args;

      logger.info(
        `[Tool] [${context.sessionId}] search_files called: query="${query}", file_type=${file_type}, channels=${JSON.stringify(channels)}`,
      );

      // ── Build FileFilters ──────────────────────────────────────────────

      const fileFilters: Partial<FileFilters> = {};

      // SubApp filter (file_type → subApp)
      if (file_type) {
        const upper = file_type.toUpperCase();
        const validTypes = ['CANVAS', 'TRANSCRIPT', 'RCA', 'CHAT_ATTACHMENT'];
        if (!validTypes.includes(upper)) {
          return `Error: Invalid file_type "${file_type}". Valid values are: ${validTypes.join(', ')}`;
        }
        fileFilters.subApp = [upper];
      }

      // Date filters
      if (createdBefore) fileFilters.createdBefore = createdBefore;
      if (createdAfter) fileFilters.createdAfter = createdAfter;
      if (createdOn) fileFilters.createdOn = createdOn;

      // ── Resolve created_by ─────────────────────────────────────────────

      if (created_by) {
        const { userId, notFound } = resolveUserName(created_by, context.requestMappings);
        if (notFound || !userId) {
          return `Error: The username "${created_by}" was not found. Please call field_value_discovery with usernames=["${created_by}"] first to validate.`;
        }
        // Apply ownerId filter to scope results to files created by the specified user
        fileFilters.ownerId = [userId];
        logger.info(`[Tool] search_files: Resolved created_by "${created_by}" to userId=${userId}`);
      }

      // ── Resolve channels ───────────────────────────────────────────────

      if (channels && channels.length > 0) {
        const { channelIds, notFound } = resolveChannelNames(
          channels,
          context.contextChannelMap,
          context.requestMappings,
        );

        if (notFound.length > 0) {
          return `Error: The following channel names were not found: ${notFound.join(', ')}. Please call field_value_discovery first.`;
        }

        if (channelIds.length === 0) {
          return 'Error: No valid channel IDs could be resolved. Please call field_value_discovery first.';
        }

        // channelId is a derived field imported from channelRef.docId in the Vespa file schema.
        // Vespa already handles access control via permissions and isPrivate fields,
        // so we only need to scope by channel — no additional DB validation required.
        fileFilters.channelId = channelIds;
      }

      // ── Execute search ─────────────────────────────────────────────────

      const result = await searchFilesImpl(query, context.userId, context.sessionId, fileFilters);

      // ── Store citation mappings & format output ────────────────────────

      const prefix = await getNextPrefix(context.sessionId);
      if (result.success && result.entities.length > 0) {
        const citationMappings = buildEnhancedCitationMappings(result);
        await appendEnhancedSessionMappings(context.sessionId, citationMappings, prefix);
      }

      // Track metrics
      try {
        askAIFileSearchUsedTotal.add(1)
      } catch(metricsError) {
        logger.error('[Tool] search_files: Error recording metrics:', metricsError);
      }

      const toolOutput = formatEnhancedToolResultForContext(result, prefix);
      return toolOutput;
    },
  };
}

/**
 * Get search_files tool
 * MUST call initializeTools() before using
 */
export function getSearchFilesTool() {
  return createSearchFilesTool();
}

