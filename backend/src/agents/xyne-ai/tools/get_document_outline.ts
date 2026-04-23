/**
 * Get Document Outline Tool
 *
 * Retrieves the stored `documentOutline` field from file documents in Vespa.
 * The outline is a pre-extracted Table of Contents with page numbers, e.g.:
 *   - topicA (Page 1)
 *   - topicB (Page 2)
 *
 * Supports two modes:
 *  - Direct fetch by `docIds` (exact files, uses crudService.getDocument)
 *  - Semantic search by `query` (finds relevant files via searchVespa)
 */

import { z } from 'zod';
import { type Tool } from '@juspay-jaf/jaf';
import vespaClient from '../../../vespa/client/index.js';
import { vespaService } from '../../../services/vespaSearch/index.js';
import { fileSchema, RankProfile } from '../../../vespa/src/types.js';
import { logger } from '../../../utils/logger.js';
import type { VespaFileDocument, VespaFileSearchDocument, VespaSearchHit } from '../../../vespa/src/types.js';
import type { XyneAIAgentContext } from './types.js';
import { getDescription } from './helpers.js';

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create get_document_outline tool — retrieves stored document outline (TOC)
 */
export function createGetDocumentOutlineTool(): Tool<
  {
    query?: string;
    docIds?: string[];
    limit?: number;
    offset?: number;
  },
  XyneAIAgentContext
> {
  return {
    schema: {
      name: 'get_document_outline',
      description: getDescription('get_document_outline'),
      parameters: z.object({
        query: z
          .string()
          .min(4)
          .optional()
          .describe(
            'Semantic search query to find relevant documents. REQUIRED if docIds is not provided. Use a descriptive phrase — not a single generic word.',
          ),
        docIds: z
          .array(z.string())
          .max(5)
          .optional()
          .describe(
            'Array of Vespa document IDs (up to 5) to fetch outlines for directly. Use the "doc_id" value shown in search_files results (e.g. "clf-abc123..."). If provided, query can be omitted.',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe('Maximum number of outlines to return (1-10). Defaults to 5.'),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Pagination offset for the underlying file search. Use when the system indicates more outlines are available.'),
      }),
    },
    execute: async (args, context) => {
      const { query, docIds, limit, offset } = args;
      const { userId, sessionId } = context;

      const maxOutlines = limit ?? 5;

      logger.info(
        `[Tool] [${sessionId}] get_document_outline: query="${query}", docIds=${JSON.stringify(docIds)}, limit=${maxOutlines}`,
      );

      if (!query && (!docIds || docIds.length === 0)) {
        return 'Either `query` or `docIds` must be provided to retrieve document outlines.';
      }

      const discoveredOutlines: Array<{
        docId: string;
        fileName: string;
        outline: string;
      }> = [];
      const seenDocIds = new Set<string>();

      try {
        if (docIds && docIds.length > 0) {
          // ── Direct fetch by document IDs ──────────────────────────────────
          for (const docId of docIds) {
            if (discoveredOutlines.length >= maxOutlines) break;

            try {
              const rawDoc = await vespaClient.crudService.getDocument(docId, fileSchema);

              if (!rawDoc || !(rawDoc as any).fields) {
                logger.warn(`[Tool] [${sessionId}] get_document_outline: doc "${docId}" not found`);
                continue;
              }

              const fields = (rawDoc as any).fields as VespaFileDocument;
              if (seenDocIds.has(docId)) continue;
              seenDocIds.add(docId);

              if (!fields.documentOutline) {
                logger.info(`[Tool] [${sessionId}] get_document_outline: no stored outline for "${docId}"`);
                continue;
              }

              discoveredOutlines.push({
                docId,
                fileName: fields.fileName || 'Untitled',
                outline: fields.documentOutline,
              });
            } catch (fetchErr) {
              logger.warn(`[Tool] [${sessionId}] get_document_outline: error fetching "${docId}":`, fetchErr);
            }
          }
        } else if (query) {
          // ── Query-based search ────────────────────────────────────────────
          const searchResult = await vespaService.searchService.searchVespa(
            query,
            userId,
            ['file'],
            {
              offset: offset ?? 0,
              // Fetch 3x the limit to account for docs without outlines and de-duplication
              limit: maxOutlines * 3 + (offset ?? 0),
              rankProfile: RankProfile.nativeRank,
            },
          );

          const hits: VespaSearchHit[] = searchResult?.root?.children || [];

          for (const hit of hits) {
            if (discoveredOutlines.length >= maxOutlines) break;

            const fields = hit.fields as VespaFileSearchDocument;
            if (!fields?.docId) continue;
            if (seenDocIds.has(fields.docId)) continue;
            seenDocIds.add(fields.docId);

            if (!fields.documentOutline) continue;

            discoveredOutlines.push({
              docId: fields.docId,
              fileName: fields.fileName || 'Untitled',
              outline: fields.documentOutline,
            });
          }
        }

        if (discoveredOutlines.length === 0) {
          const ctx = docIds
            ? `file IDs: ${docIds.join(', ')}`
            : `query "${query}"`;
          return `No document outlines found for ${ctx}. The matching files may not have a stored outline yet, or no files were found.`;
        }

        // ── Format output ─────────────────────────────────────────────────
        const hasMore = !docIds && discoveredOutlines.length >= maxOutlines;
        const nextOffset = (offset ?? 0) + maxOutlines * 3;

        let output = `<document_outlines query="${query ?? ''}" documents_found="${seenDocIds.size}" outlines_returned="${discoveredOutlines.length}">\n`;

        for (const { docId, fileName, outline } of discoveredOutlines) {
          output += `<document_outline doc_id="${docId}" title="${fileName}">\n`;
          output += `${outline}\n`;
          output += `</document_outline>\n`;
        }

        if (hasMore) {
          output += `<system_instruction>More outlines may be available. Call get_document_outline again with offset: ${nextOffset} to see more.</system_instruction>\n`;
        }

        output += `</document_outlines>`;

        logger.info(
          `[Tool] [${sessionId}] get_document_outline: Returned ${discoveredOutlines.length} outline(s)`,
        );

        return output.trim();
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error(`[Tool] [${sessionId}] get_document_outline error:`, error);
        return `Error retrieving document outlines: ${errMsg}`;
      }
    },
  };
}

export function getGetDocumentOutlineTool() {
  return createGetDocumentOutlineTool();
}
