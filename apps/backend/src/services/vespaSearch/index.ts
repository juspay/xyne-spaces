import { createVespaService, type VespaDependencies } from 'vespa/src';
import { logger } from '@/utils/logger';
import { Request, Response } from 'express';
import config from 'vespa/src/config';
import {
  transformVespaResults,
  type TransformedSearchResult,
} from './resultTransform';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { VALID_DOC_TYPES } from '@/utils/idValidator';
import { MatchFeatures, RankProfile, SubApp, VespaDocType, VespaSearchHit, fileSchema } from '@/vespa/src/types';


// Create dependencies
const dependencies: VespaDependencies = {
  logger: logger,
  config: config
};

// Create vespa service instance
const vespaService = createVespaService(dependencies);

/**
 * Parse Vespa grouped results structure
 * Returns either grouped results or flat results depending on response structure
 */
function parseVespaResults(children: any[]): { grouped: boolean; groups?: any[]; hits?: any[]; cntRemoved?: Number } {
  if (!children || children.length === 0) {
    return { grouped: false, hits: [] };
  }

  // Check if this is a grouped response
  const hasGrouping = children.some(child => 
    child.id && (child.id.startsWith('group:') || child.id.startsWith('grouplist:'))
  );

  if (!hasGrouping) {
    // Regular flat results
    return { grouped: false, hits: children };
  }

  // Parse grouped structure
  const groups: any[] = [];
  let removedCount = 0
  function extractGroups(items: any[], groupByField?: string, groupValue?: string) {
    for (const item of items) {
      if (item.id && item.id.startsWith('grouplist:')) {
        // This is a group list container
        const field = item.label || item.id.replace('grouplist:', '');
        if (item.children) {
          extractGroups(item.children, field);
        }
      } else if (item.id && item.id.startsWith('group:')) {
        // This is a specific group value
        const value = item.value || item.id.split(':').pop();
        if (item.children) {
          extractGroups(item.children, groupByField, value);
        }
      } else if (item.fields) {
        // This is an actual hit - add to current group
        if (groupByField && groupValue) {
          let group = groups.find(g => g.groupBy === groupByField && g.groupValue === groupValue);
          if (!group) {
            group = {
              groupBy: groupByField,
              groupValue: groupValue,
              hits: []
            };
            groups.push(group);
          }
          group.hits.push(item);
        }
      } else if (item.children) {
        // Recurse into nested children
        extractGroups(item.children, groupByField, groupValue);
      }
    }
  }

  extractGroups(children);
  return { grouped: true, groups , cntRemoved:removedCount};
}

const MAX_FILTER_VALUES = 50;
const MAX_VESPA_HITS = 400;

/**
 * Keep every non-mail hit, but only the highest-ranked mail hit for each Desk
 * conversation. Vespa returns hits in relevance order, so retaining the first
 * mail for a thread preserves the correct representative.
 */
function dedupeMailHits(hits: VespaSearchHit[]): VespaSearchHit[] {
  const seenMailThreads = new Set<string>();

  return hits.filter(hit => {
    if (hit.fields?.docType !== VespaDocType.MAIL) return true;

    const threadId = (hit.fields as { threadId?: string }).threadId?.trim();
    if (!threadId) return true;
    if (seenMailThreads.has(threadId)) return false;

    seenMailThreads.add(threadId);
    return true;
  });
}

/**
 * Lean Vespa summaries do not always include threadId. After transformation,
 * Desk mail results have their authoritative Postgres conversationId, so use
 * that as the final mail-only deduplication key.
 */
function dedupeMailResults(
  results: TransformedSearchResult[],
): TransformedSearchResult[] {
  const seenMailConversations = new Set<string>();

  return results.filter(result => {
    const searchContext = result.searchContext;
    if (!searchContext?.mailId) return true;

    const conversationKey =
      searchContext.conversationId ??
      searchContext.ticketId ??
      searchContext.xyneId;
    if (!conversationKey) return true;
    if (seenMailConversations.has(conversationKey)) return false;

    seenMailConversations.add(conversationKey);
    return true;
  });
}

class ValidationError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const toCommaSeparatedValues = (value: unknown): string[] => {
  if (value === undefined || value === null) {
    return [];
  }

  const values = Array.isArray(value) ? value : [value];
  return values.flatMap(item => {
    if (typeof item !== 'string') {
      return [];
    }

    return item
      .split(',')
      .map(part => part.trim())
      .filter(Boolean);
  });
};

const toFilterValues = (value: unknown, fieldName = 'filter'): string[] => {
  const arr = toCommaSeparatedValues(value);
  if (arr.length > MAX_FILTER_VALUES) {
    throw new ValidationError(
      `Filter "${fieldName}" exceeds the maximum of ${MAX_FILTER_VALUES} values (got ${arr.length})`,
    );
  }
  return arr;
};

const parseJsonObject = <T extends Record<string, unknown>>(value: unknown): T | undefined => {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as T;
    }
  } catch (error) {
    logger.warn(`Failed to parse JSON payload: ${String(error)}`);
  }

  return undefined;
};



// Export search handler function
export const searchHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      q,
      apps = 'slack,ticket,user,file,mail',
      offset = 0,
      limit,
      rankProfile,
      // Frontend-compatible filters
      type,        // 'messages' | 'attachments' | 'channels' | 'tickets' | 'files'
      subApp,      // 'canvas' | 'transcript' | 'RCA' - sub-app filter for files
      from,        // User name or ID
      fromEmail,   // Desk: sender email address(es) for mail `from:` filter
      toEmail,     // Desk: recipient email address(es) for mail `to:` filter
      withUser,    // User ID for participant filter
      in: inChannel, // Channel name or ID (renamed to avoid 'in' keyword)
      mentions,        // User ID(s) mentioned in the message (scoped mention search)
      channelMentions, // Channel ID(s) referenced in the message (scoped mention search)
      entityId,        // Extracted-entity ID(s) the message was tagged with
      mentionHighlights, // Display name(s) of bare mention chips — highlighted in results, not in YQL
      // Unified filters (work for both slack and ticket)
      projectId,   // Project ID(s) - comma-separated
      // Ticket-specific filters
      status,      // Ticket status(es) - comma-separated
      ticketId,     // Specific ticket ID(s) - comma-separated
      priority,    // Priority (HIGH, MEDIUM, LOW) - comma-separated
      searchId,
      board,       // Board name/ID
      tags,        // Comma-separated tags (ticket Tag framework — NOT thread types)
      threadType,  // Thread classification type(s) - comma-separated; matches thread roots
      messageActs, // Thread type(s) a message was cited as evidence for - comma-separated
      dynamicFieldValues, // Dynamic field filters
      dynamicFieldDateRanges, // JSON string of fieldId -> { start, end }
      before,      // Created before date (multiple formats)
      after,       // Created after date (multiple formats)
      on,          // Created on specific date (multiple formats)
      range,       // Time keyword filter (today, yesterday, etc.)
      callStatus,  // Call status filter
      callStartsAt,    // Call visible range start timestamp
      callEndsAt,      // Call visible range end timestamp
      stage,       // Ticket stage
      assignee,    // Assigned user name
      filterOnly,  // Flag for filter-only search (no query text)
      collectionId, // KB collection id(s) - comma-separated; restricts file results to those clIds
      fileId,      // KB file id(s) - comma-separated; restricts file results to those Vespa docIds (collectionItem.fileId)
      callType,   // Call type filter (e.g. HEADLESS for recordings)
      presentationSummary, // Optional Vespa presentation.summary profile (e.g. 'lean')
      includeBotMessages,  // 'true'|'false' string from cmd-K toggle; default behavior excludes BOT messages
      onlyMyChannels,      // 'true'|'false' string from cmd-K toggle; default behavior includes public channels
      includeDebugInfo,    // 'true' => attach matchfeatures/rankfeatures debug info to each result
      groupBy,    // Override Vespa grouping. Empty string => flat ranked list (no grouping).
      // Chunk-level KB drill-in mode used by claw-auth's kb-get-chunks /
      // kb-search-within-doc tools. Opt-in via includeChunkLevel='true' AND a
      // fileId — short-circuits the normal pipeline and returns raw chunk-level
      // data (chunks_summary + matchfeatures.chunk_scores + chunks_map_summary)
      // instead of the single-snippet shape transformCollection() produces.
      // Every other request flows through the unchanged search path.
      includeChunkLevel,   // 'true' => emit chunk-level data for KB drill-in
      startChunkIndex,     // 0-based offset into the doc's chunks (no-query mode)
      chunkLimit,          // max chunks to return in no-query mode (1-30, default 15)
      orderBy,             // 'newest' | 'oldest' | 'relevance' — Vespa ORDER BY timestamp
      view,                // xyne-apps view: 'installed' | 'org' | 'marketplace'
      // Note: subApp was moved up to be with other frontend filters
    } = req.query;

    // Joi validateQuery (convert: true) coerces includeDebugInfo to a boolean,
    // so normalize before comparing
    const wantDebugInfo = String(includeDebugInfo) === 'true';

    const userId = (req as any).user?.id;
    const userEmail = (req as any).user?.email;
    const workspaceId = (req as any).user?.workspaceId;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    if (!workspaceId) {
      res.status(403).json({ success: false, error: 'Forbidden: workspace context required' });
      return;
    }

    // ── Chunk-level KB drill-in (additive, opt-in) ─────────────────────────
    //
    // When `includeChunkLevel='true'` and a `fileId` is supplied, return raw
    // chunk-level data for that ONE document instead of the normal snippet-
    // per-doc list. Two sub-modes:
    //   - `q` empty  → fetch the doc via Vespa's document API and slice
    //                  `chunks` by [startChunkIndex, +chunkLimit). Used by
    //                  kb-get-chunks.
    //   - `q` set    → run searchVespa scoped to that docId, pull chunk
    //                  scores + snippets from the hit's matchfeatures. Used
    //                  by kb-search-within-doc.
    //
    // SECURITY: both paths re-verify the calling user against the doc's
    // `permissions` array (the same field YqlBuilder gates search results on
    // via `permissions contains <userId>` — see YqlBuilder.ts:451). Direct
    // Vespa document fetches don't filter by user, so this check is the trust
    // boundary.
    if (String(includeChunkLevel) === 'true') {
      const fileIdsCsv = toCommaSeparatedValues(fileId);
      const targetDocId = Array.isArray(fileIdsCsv) ? fileIdsCsv[0] : undefined;
      if (!targetDocId) {
        res.status(400).json({
          success: false,
          error: 'includeChunkLevel=true requires a fileId (Vespa docId)',
        });
        return;
      }
      const wantQuery = typeof q === 'string' && q.trim().length > 0;
      const limitParsed = Math.min(
        Math.max(Number(chunkLimit ?? 15), 1),
        30,
      );

      try {
        if (!wantQuery) {
          // No-query: direct doc fetch. The Vespa document API returns the
          // raw stored fields (no `chunks_summary` projection), so we read
          // `chunks` first and fall back to `chunks_summary` for parity with
          // the SEBI getChunks implementation.
          const startIdx = Math.max(Number(startChunkIndex ?? 0), 0);
          const raw = await vespaService.vespaClient.getDocument({
            docId: targetDocId,
            namespace: config.namespace,
            schema: fileSchema,
            cluster: config.cluster,
          });
          const fields = (raw?.fields ?? {}) as Record<string, any>;
          // Access rule:
          //   - PRIVATE doc (isPrivate !== false): owner OR in `permissions`.
          //   - PUBLIC doc  (isPrivate === false): owner OR in `permissions`
          //     OR a participant of the doc's chat channel (`channelRef`).
          const perms = Array.isArray(fields.permissions) ? fields.permissions : [];
          const isOwner = fields.ownerId === userId;
          const isShared = perms.includes(userId);
          const isPublic = fields.isPrivate === false;
          // Private docs: owner or explicit `permissions` only.
          // Public docs: owner, `permissions`, OR a participant of the doc's
          // chat channel (via `channelRef`).
          let allowed = isOwner || isShared;
          // Channel-participant access: a doc may belong to a chat channel via
          // `channelRef` (format `id:namespace:chat_container::<channelId>`).
          // Only consulted for public docs, and only when the cheaper checks
          // above didn't already pass.
          if (!allowed && isPublic) {
            const channelRef =
              typeof fields.channelRef === 'string' ? fields.channelRef : '';
            const channelId = channelRef ? (channelRef.split('::').pop() ?? '') : '';
            if (channelId) {
              const participant =
                await repositories.channelParticipants.findParticipant(
                  channelId,
                  userId,
                );
              allowed = participant !== null;
            }
          }
          if (!allowed) {
            res.status(403).json({ success: false, error: 'Forbidden' });
            return;
          }
          const rawChunks: unknown =
            (Array.isArray(fields.chunks) && fields.chunks) ||
            (Array.isArray(fields.chunks_summary) && fields.chunks_summary) ||
            [];
          const allChunks: string[] = (rawChunks as unknown[]).map((c) => {
            if (typeof c === 'string') return c;
            if (c && typeof c === 'object') {
              const o = c as { chunk?: string; text?: string };
              return o.chunk ?? o.text ?? '';
            }
            return '';
          });
          const total = allChunks.length;
          if (total === 0) {
            res.json({
              success: true,
              data: {
                mode: 'chunks',
                docId: targetDocId,
                title: fields.title ?? fields.fileName ?? targetDocId,
                total_chunks: 0,
                returned: 0,
                start: startIdx,
                end: startIdx,
                has_more: false,
                chunks: [],
              },
            });
            return;
          }
          if (startIdx >= total) {
            res.status(400).json({
              success: false,
              error: `startChunkIndex ${startIdx} is past the end of the document (total chunks: ${total}).`,
            });
            return;
          }
          const end = Math.min(startIdx + limitParsed, total);
          const slice = allChunks.slice(startIdx, end);
          const chunksMap = Array.isArray(fields.chunks_map)
            ? (fields.chunks_map as Array<{
                chunk_index: number;
                page_numbers?: number[];
                block_labels?: string[];
              }>)
            : [];
          const mapByIndex = new Map(chunksMap.map((m) => [m.chunk_index, m]));
          const chunks = slice.map((text, i) => {
            const index = startIdx + i;
            const meta = mapByIndex.get(index);
            const cleaned = String(text).replace(/^\[Page \d+(-\d+)?\]\s*/, '');
            return {
              index,
              text: cleaned,
              ...(meta?.page_numbers ? { page_numbers: meta.page_numbers } : {}),
              ...(meta?.block_labels ? { block_labels: meta.block_labels } : {}),
            };
          });
          res.json({
            success: true,
            data: {
              mode: 'chunks',
              docId: targetDocId,
              title: fields.title ?? fields.fileName ?? targetDocId,
              total_chunks: total,
              returned: slice.length,
              start: startIdx,
              end: end - 1,
              has_more: end < total,
              chunks,
            },
          });
          return;
        }

        // With-query: semantic search scoped to one docId. Reuse the existing
        // searchVespa pipeline so per-user permissions + YQL builder stay in
        // play; we just emit chunk-level data from the hit instead of running
        // it through transformCollection().
        const searchOpts: any = {
          offset: 0,
          limit: limitParsed,
          slack: {},
          ticket: {},
          file: {
            fileId: [targetDocId],
            subApp: ['collections'],
          },
          mail: { userEmail },
          workspaceId,
        };
        if (wantDebugInfo) {
          searchOpts.captureDebug = (info: {
            stage: string;
            yql: string;
            vespaParams: Record<string, unknown>;
          }) => {
            // Inline capture; surfaced on the response below.
            (searchOpts as any).__debug = (searchOpts as any).__debug ?? [];
            (searchOpts as any).__debug.push(info);
          };
        }
        const searchResp = await vespaService.searchService.searchVespa(
          q as string,
          userId,
          ['file'],
          searchOpts,
          searchId as string,
        );
        const children = searchResp?.root?.children ?? [];
        const hits: Array<{
          rank: number;
          chunk_index: number | null;
          score: number;
          snippet: string;
          page_numbers?: number[];
          block_labels?: string[];
        }> = [];
        let docTitle: string | undefined;
        let docTotalChunks: number | undefined;

        const firstFields = (children[0]?.fields ?? {}) as Record<string, any>;
        docTitle = firstFields.title ?? firstFields.fileName ?? targetDocId;
        if (Array.isArray(firstFields.chunks_map_summary)) {
          docTotalChunks = firstFields.chunks_map_summary.length;
        } else if (Array.isArray(firstFields.chunks_map)) {
          docTotalChunks = firstFields.chunks_map.length;
        }

        // A single hit (the doc) carries N ranked chunks inside its
        // matchfeatures.chunk_scores.cells map. We expand into per-chunk rows
        // up to `limitParsed`, sorted by descending score.
        for (let i = 0; i < children.length && hits.length < limitParsed; i++) {
          const hit = children[i] as any;
          const fields = (hit?.fields ?? {}) as Record<string, any>;
          const mf = fields.matchfeatures as
            | { chunk_scores?: { cells?: Record<string, number> } }
            | undefined;
          const cells = mf?.chunk_scores?.cells ?? {};
          const ranked: Array<{ index: number; score: number }> = [];
          for (const [k, v] of Object.entries(cells)) {
            const idx = Number(k);
            if (typeof v === 'number' && Number.isFinite(idx)) {
              ranked.push({ index: idx, score: v });
            }
          }
          ranked.sort((a, b) => b.score - a.score);
          const chunksSummary = Array.isArray(fields.chunks_summary)
            ? (fields.chunks_summary as unknown[])
            : [];
          const chunksPosSummary = Array.isArray(fields.chunks_pos_summary)
            ? (fields.chunks_pos_summary as number[])
            : [];
          // For small or few-chunk docs Vespa skips the chunks_summary
          // projection and returns the raw `chunks` array on the hit instead;
          // fall back to that so the snippet isn't empty.
          const chunksFull = Array.isArray(fields.chunks)
            ? (fields.chunks as unknown[])
            : [];
          const chunksMapSummary = Array.isArray(fields.chunks_map_summary)
            ? (fields.chunks_map_summary as Array<{
                chunk_index: number;
                page_numbers?: number[];
                block_labels?: string[];
              }>)
            : Array.isArray(fields.chunks_map)
              ? (fields.chunks_map as Array<{
                  chunk_index: number;
                  page_numbers?: number[];
                  block_labels?: string[];
                }>)
              : [];
          const pickToText = (pick: unknown): string => {
            if (typeof pick === 'string') return pick;
            if (pick && typeof pick === 'object') {
              const o = pick as { chunk?: string; text?: string };
              return o.chunk ?? o.text ?? '';
            }
            return '';
          };
          const snippetForIdx = (chunkIndex: number): string => {
            // `chunks` on a hit is pruned by `select-elements-by: best_chunks`,
            // so it holds the top-scoring chunks RE-NUMBERED from 0.
            // `chunks_pos_summary` is `chunks_pos` pruned by the same selector,
            // so it maps a document chunk index to its slot in that array.
            // Indexing `chunks` by the document index instead served one chunk's
            // text under another chunk's page — the reason every citation came
            // back as chunk 0. Unplaceable text is dropped, not guessed at.
            const at = chunksPosSummary.indexOf(chunkIndex);
            if (at < 0) return '';
            // Strip the [Page N] ingestion prefix to match kb-get-chunks output.
            return (pickToText(chunksSummary[at]) || pickToText(chunksFull[at]))
              .replace(/^\[Page \d+(-\d+)?\]\s*/, '');
          };
          for (const r of ranked) {
            if (hits.length >= limitParsed) break;
            const meta = chunksMapSummary.find(
              (m) => m.chunk_index === r.index,
            );
            hits.push({
              rank: hits.length + 1,
              chunk_index: r.index,
              score: r.score,
              snippet: snippetForIdx(r.index),
              ...(meta?.page_numbers ? { page_numbers: meta.page_numbers } : {}),
              ...(meta?.block_labels ? { block_labels: meta.block_labels } : {}),
            });
          }
        }

        res.json({
          success: true,
          data: {
            mode: 'within-doc',
            docId: targetDocId,
            title: docTitle,
            query: q,
            total_chunks: docTotalChunks,
            hits,
            ...(wantDebugInfo && (searchOpts as any).__debug
              ? { debug: { payloads: (searchOpts as any).__debug } }
              : {}),
          },
        });
        return;
      } catch (err: any) {
        logger.error(`includeChunkLevel error for fileId=${targetDocId}:`, err);
        res.status(500).json({
          success: false,
          error: err?.message ?? 'chunk-level fetch failed',
        });
        return;
      }
    }

    // Allow empty query if filterOnly is true
    if (!q && filterOnly !== 'true') {
      res.status(400).json({ success: false, error: 'Query parameter "q" is required' });
      return;
    }

    // xyne-apps catalog search — dedicated `app` schema. No per-user ACL (route is
    // already gated by the XYNE-APPS resource permission); scoped to one of the
    // three Apps views in the search service. Short-circuits the universal
    // chat/ticket/file pipeline below.
    if (String(apps).trim() === 'xyneapp') {
      const rawView = String(view ?? 'installed');
      const appsView: 'installed' | 'org' | 'marketplace' =
        rawView === 'org' || rawView === 'marketplace' ? rawView : 'installed';
      // Org view needs the caller's org id (apps have no workspaceId — they're
      // org-scoped). Resolve it from the caller's workspace.
      let callerOrgId: string | undefined;
      if (appsView === 'org' && workspaceId) {
        const ws = await db.workspace.findUnique({
          where: { id: workspaceId },
          select: { orgId: true },
        });
        callerOrgId = ws?.orgId ?? undefined;
      }
      const { results, total } = await vespaService.searchService.searchApps(String(q ?? ''), workspaceId, {
        view: appsView,
        orgId: callerOrgId,
        limit: limit ? Number(limit) : 50,
        offset: offset ? Number(offset) : 0,
      });
      res.json({ success: true, results, total });
      return;
    }

    const isFilterOnlyDynamicFieldSearch =
      filterOnly === 'true' &&
      (dynamicFieldValues !== undefined || dynamicFieldDateRanges !== undefined);
    const effectiveLimit =
      limit !== undefined ? Number(limit) : isFilterOnlyDynamicFieldSearch ? 200 : 20;

    // Build options object
    const options: any = {
      offset: Number(offset),
      limit: effectiveLimit,
      slack: {},
      ticket: {},
      file: {},
      mail: { userEmail },
      call: {},
      filterOnly: filterOnly === 'true',
      workspaceId,
    };

    // When includeDebugInfo=true, capture every Vespa payload (exact + any
    // fuzzy fallback) emitted by searchService so we can return them in the
    // response. Tools like claw-auth's kb-search/spaces-search use this to
    // persist the actual YQL + bound params for offline replay.
    const capturedDebug: Array<{ stage: string; yql: string; vespaParams: Record<string, unknown> }> = [];
    if (wantDebugInfo) {
      options.captureDebug = (info: { stage: string; yql: string; vespaParams: Record<string, unknown> }) => {
        capturedDebug.push(info);
      };
    }
    
     if (rankProfile) {
      options.rankProfile = rankProfile as string;
    }

    if (typeof groupBy === 'string') {
      options.groupBy = groupBy;
    }

    // Network Conditions override for testing Cmd+K rank profiles.
    // `unified` selects the named unified profile; the legacy `search<N>`
    // convention selects default_native_<N>, with search50 as personalized.
    const userAgent = req.get('User-Agent') || '';
    const isUnifiedProfile = userAgent.trim().toLowerCase() === RankProfile.unifiedRank;
    const numericProfileToken = userAgent.includes('search')
      ? userAgent.match(/(\d+)$/)?.[1]
      : undefined;

    if (isUnifiedProfile) {
      options.rankProfile = RankProfile.unifiedRank;
      // Match the full-search `unified` path: its normalized cross-schema
      // scores must remain in one global list instead of docType buckets.
      options.groupBy = '';
    } else if (numericProfileToken) {
      options.rankProfile =
        Number(numericProfileToken) === 50
          ? RankProfile.personalizedRank
          : `${RankProfile.nativeRank}_${numericProfileToken}`;
    }

    if (isUnifiedProfile || numericProfileToken) {
      logger.info(
        `[vespa-search, ${searchId ? searchId : ''}] User-Agent rank-profile override: ${options.rankProfile}`,
      );
    }

    // Determine which apps to search based on type filter
    let searchApps = (apps as string).split(',');

    const validTypes = VALID_DOC_TYPES as readonly string[];

    // Map frontend 'type' filter to docType and subApp
    if (type) {
      // Frontend sends exact type names only (prefix expansion is handled client-side)
      const types = (type as string).split(',').map(t => t.trim().toLowerCase()).filter(t => validTypes.includes(t));

      // Unified type mapping — includes subApp types (canvas, transcript, rca)
      // Types filtered locally (users, people, channels) have null app so they don't trigger a Vespa search
      const typeMapping: Record<string, { app: 'chat' | 'ticket' | 'file' | 'mail' | 'call' | null, optionsKey: 'slack' | 'ticket' | 'file' | 'mail' | 'call', docType: string, subApp?: string }> = {
        'messages': { app: 'chat', optionsKey: 'slack', docType: VespaDocType.MESSAGE },
        'attachments': { app: 'chat', optionsKey: 'slack', docType: VespaDocType.ATTACHMENT },
        'channels': { app: 'chat', optionsKey: 'slack', docType: VespaDocType.CHANNEL },
        'tickets': { app: 'ticket', optionsKey: 'ticket', docType: VespaDocType.TICKET },
        'files': { app: 'file', optionsKey: 'file', docType: VespaDocType.FILE },
        'users': { app: null, optionsKey: 'slack', docType: VespaDocType.USER },
        'people': { app: null, optionsKey: 'slack', docType: VespaDocType.USER },
        'canvas': { app: 'file', optionsKey: 'file', docType: VespaDocType.FILE, subApp: SubApp.CANVAS },
        'transcript': { app: 'file', optionsKey: 'file', docType: VespaDocType.FILE, subApp: SubApp.TRANSCRIPT },
        'rca': { app: 'file', optionsKey: 'file', docType: VespaDocType.FILE, subApp: SubApp.RCA },
        'emails': { app: 'mail', optionsKey: 'mail', docType: VespaDocType.MAIL },
        'calls': { app: 'call', optionsKey: 'call', docType: VespaDocType.CALL },
      };

      const mappedApps = new Set<'chat' | 'ticket' | 'file' | 'mail' | 'call'>();
      const subApps: string[] = [];

      types.forEach(t => {
        const mapped = typeMapping[t];
        if (mapped) {
          if (mapped.app) {
            mappedApps.add(mapped.app);
          }
          if (!options[mapped.optionsKey].docType) {
            options[mapped.optionsKey].docType = [];
          }
          options[mapped.optionsKey].docType!.push(mapped.docType);
          if (mapped.subApp) {
            subApps.push(mapped.subApp);
          }
        }
      });

      if (subApps.length > 0) {
        options.file.subApp = subApps;
      }

      // Restrict apps to only those needed for the type filter
      // If only local types (users/people/channels) were requested, search all apps
      if (mappedApps.size > 0) {
        searchApps = Array.from(mappedApps);
      }
    }
    
    // Map frontend 'from' filter to senderId (messages), createdBy (tickets), and createdBy (files)
    if (from) {
      const fromVals = toFilterValues(from, 'from');
      options.slack.senderId = fromVals;
      options.ticket.createdBy = fromVals;
      options.file.createdBy = fromVals;
    }

    if (fromEmail) {
      options.mail.from = toFilterValues(fromEmail, 'fromEmail');
    }

    if (toEmail) {
      options.mail.to = toFilterValues(toEmail, 'toEmail');
    }

    if (withUser) {
      const participantIds = toFilterValues(withUser, 'withUser');
      options.slack.participants = participantIds;
      options.call.userIds = participantIds;
    }

    // Map frontend 'in' filter to channelId
    if (inChannel) {
      const inVals = toFilterValues(inChannel, 'in');
      options.slack.channelId = inVals;
      options.ticket.channelId = inVals;
      options.mail.channelId = inVals;
      options.file.channelId = inVals;
      options.call.channelId = inVals;
    }

    // Map mention filters (scoped search): bare @user -> mentions, bare #channel -> channelMentions.
    // Both arrive as string[] post-Joi (the validator splits comma strings into arrays).
    if (mentions) {
      options.slack.mentionedUserIds = mentions;
    }
    if (channelMentions) {
      options.slack.mentionedChannelIds = channelMentions;
    }
    // Thread classification. threadType matches a thread's ROOT message, so it returns one
    // hit per thread; messageActs matches the individual messages the classifier cited as
    // evidence. Sent together they AND, which is how you ask for "the message that made this
    // an ISSUE" rather than either on its own.
    if (threadType) {
      options.slack.threadType = toFilterValues(threadType, 'threadType');
    }
    if (messageActs) {
      options.slack.messageActs = toFilterValues(messageActs, 'messageActs');
    }
    // Extracted-entity filter — the entity review screen sends this with
    // filterOnly=true and an empty q to list every message carrying an entity.
    // The builder narrows this to thread roots — one hit per thread. See YqlBuilder.
    if (entityId) {
      options.slack.entityIds = toFilterValues(entityId, 'entityId');
    }
    // Highlight-only: exact display names to bold in result snippets (kept out of the YQL filter).
    if (mentionHighlights) {
      options.mentionHighlights = mentionHighlights;
    }

    if (callStatus) {
      options.call.status = toFilterValues(callStatus, 'callStatus');
    }

    const callStartsAtTimestamp = Number(callStartsAt);
    const callEndsAtTimestamp = Number(callEndsAt);
    if (Number.isFinite(callStartsAtTimestamp)) {
      options.call.timeFrom = callStartsAtTimestamp;
    }
    if (Number.isFinite(callEndsAtTimestamp)) {
      options.call.timeTo = callEndsAtTimestamp;
    }

    // Add unified filters (apply to both slack and ticket)
    if (projectId) {
      const projectIds = toFilterValues(projectId, 'projectId');
      options.slack.projectId = projectIds;
      options.ticket.projectId = projectIds;
    }

    // Add ticket-specific filters
    if (status) {
      options.ticket.status = toFilterValues(status, 'status');
    }

    if (ticketId) {
      options.ticket.ticketId = toFilterValues(ticketId, 'ticketId');
    }

    if (priority) {
      options.ticket.priority = toFilterValues(priority, 'priority');
    }

    // New ticket filters
    if (board) {
      options.ticket.boardId = toFilterValues(board, 'board');
    }

    if (tags) {
      options.ticket.tags = toFilterValues(tags, 'tags');
    }

    if (dynamicFieldValues) {
      options.ticket.dynamicFieldValues = toFilterValues(dynamicFieldValues, 'dynamicFieldValues');
    }

    const parsedDynamicFieldDateRanges = parseJsonObject<Record<string, { start?: number; end?: number }>>(
      dynamicFieldDateRanges,
    );
    if (parsedDynamicFieldDateRanges) {
      options.ticket.dynamicFieldDateRanges = parsedDynamicFieldDateRanges;
    }

    // Date filters apply to slack, ticket, AND file (FileFilters has its own
    // createdBefore/createdAfter/createdOn/createdRange — see YqlBuilder).
    if (before) {
      options.slack.createdBefore = before as string;
      options.ticket.createdBefore = before as string;
      options.file.createdBefore = before as string;
    }

    if (after) {
      options.slack.createdAfter = after as string;
      options.ticket.createdAfter = after as string;
      options.file.createdAfter = after as string;
    }

    if (on) {
      options.slack.createdOn = on as string;
      options.ticket.createdOn = on as string;
      options.file.createdOn = on as string;
    }

    if (range) {
      options.slack.createdRange = range as string;
      options.ticket.createdRange = range as string;
      options.file.createdRange = range as string;
    }

    if (stage) {
      options.ticket.stage = toFilterValues(stage, 'stage');
    }

    if (assignee) {
      options.ticket.assignedTo = toFilterValues(assignee, 'assignee');
    }

    if (subApp) {
      options.file.subApp = toFilterValues(subApp, 'subApp');
    }

    if (collectionId) {
      options.file.collectionId = toFilterValues(collectionId, 'collectionId');
    }

    if (fileId) {
      options.file.fileId = toFilterValues(fileId, 'fileId');
    }

    if (callType) {
      const callTypeValues = toFilterValues(callType, 'callType');
      options.file.callType = callTypeValues;
      options.call.callType = callTypeValues;
    }

    if (presentationSummary) {
      options.presentationSummary = presentationSummary as string;
    }

    // Bot-message toggle: default OFF (exclude). Frontend opts-in by sending
    // includeBotMessages=true. Anything else → exclude bot messages.
    if (includeBotMessages !== 'true') {
      options.slack.excludeBotMessages = true;
    }

    // My-channels toggle: when true, scope chat results to channels the user is a
    // member of (drop the public-non-member access branch in YqlBuilder).
    options.slack.onlyMyChannels = onlyMyChannels === 'true';

    // Sort by timestamp: force flat (ungrouped) results so ORDER BY applies cleanly.
    if (orderBy === 'newest' || orderBy === 'oldest') {
      options.sort = orderBy as string;
      options.groupBy = '';
    }

    const isMailOnlySearch =
      searchApps.length === 1 && searchApps[0].trim().toLowerCase() === 'mail';
    const mailGroupOffset = isMailOnlySearch
      ? Math.max(Number(offset) || 0, 0)
      : 0;

    // Vespa's top-level offset paginates hits, not grouping buckets. Desk mail
    // results are grouped by threadId, so fetch the ranked group prefix and
    // slice the requested page after parsing the grouping response.
    if (isMailOnlySearch && mailGroupOffset > 0) {
      options.offset = 0;
      options.limit = Math.min(MAX_VESPA_HITS, mailGroupOffset + effectiveLimit);
    }

    // Call vespa search
    const results = await vespaService.searchService.searchVespa(
      q as string,
      userId,
      searchApps,
      options,
      searchId as string
    );

    // Create a map of docId -> matchfeatures from children
    const matchFeaturesMap = new Map<string, MatchFeatures>();
    (results.root.children || []).forEach((child: any) => {
      if (child.fields?.docId && child.fields?.matchfeatures) {
        matchFeaturesMap.set(child.fields.docId, child.fields.matchfeatures);
      }
    });

    // Parse Vespa results (grouped or flat)
    const parsedResults = parseVespaResults(results.root.children || []);

    if (parsedResults.grouped && parsedResults.groups) {
      // Grouped result don't have matchFeatures
      // Need to be added explicitly
      // Return grouped results
      const pageGroups = isMailOnlySearch
        ? parsedResults.groups.slice(mailGroupOffset, mailGroupOffset + effectiveLimit)
        : parsedResults.groups;

      const groupedResults = await Promise.all(
        pageGroups.map(async (group) => {
          // Attach matchfeatures to each hit's fields before transformation
          const hitsWithMatchFeatures = dedupeMailHits(
            group.hits.map((hit: VespaSearchHit) => ({
              ...hit,
              fields: {
                ...hit.fields,
                matchfeatures: matchFeaturesMap.get(hit.fields?.docId) || null
              }
            })),
          );
          const transformedHits = dedupeMailResults(
            await transformVespaResults(
              hitsWithMatchFeatures,
              db,
              wantDebugInfo,
            ),
          );
          return {
            groupBy: group.groupBy,
            groupValue: group.groupValue,
            count: transformedHits.length,
            results: transformedHits
          };
        })
      );

      res.json({
        success: true,
        data: {
          grouped: true,
          groups: groupedResults,
          totalCount: (parsedResults.cntRemoved && groupedResults.length > 0) ? (Number(offset) + groupedResults[0].count) : results.root.fields?.totalCount,
          offset: Number(offset),
          limit: effectiveLimit,
          ...(wantDebugInfo ? { debug: { payloads: capturedDebug } } : {}),
        }
      });
    } else {
      // Return flat results (backward compatible)
      // flat results will have matchFeatures returned by vespa.
      // No need to add.
      const pageResults = await transformVespaResults(
        parsedResults.hits || [],
        db,
        wantDebugInfo,
      );

      res.json({
        success: true,
        data: {
          grouped: false,
          results: pageResults,
          totalCount: results.root.fields?.totalCount || 0,
          offset: Number(offset),
          limit: effectiveLimit,
          ...(wantDebugInfo ? { debug: { payloads: capturedDebug } } : {}),
        }
      });
    }
  } catch (error: any) {
    if (error instanceof ValidationError) {
      res.status(400).json({ success: false, error: error.message });
      return;
    }
    logger.error('Search error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
};

// Export vespa service and client for other uses
export { vespaService };
export const vespaClient = vespaService.vespaClient;
