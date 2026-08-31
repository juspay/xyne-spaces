import {
  parseTimeKeywords,
  formatTimeRange,
  type ParsedTimeQuery,
} from '../utils/timeKeywordParser';
import type vespaClient from '../client';
import {
  type VespaSearchResponse,
  RankProfile,
  VespaDocType,
  userSchema,
  messageSchema,
  attachmentSchema,
  channelSchema,
  ticketSchema,
  fileSchema,
  mailSchema,
  callSchema,
} from '../types';
import VespaClient from '../client/vespaClient';
import { getErrorMessage } from '../utils';
import config from '../config';
import { YqlBuilder, type SlackFilters, type TicketFilters, type FileFilters, type MeetingFilters, type MailFilters, type CallFilters } from '../utils/YqlBuilder';
import {
  filterByNativeRank,
} from '../utils/responseProcessor';
import { executeFuzzyFallback } from '../utils/fallback';
import { highlightText } from '../utils/highlight';
import { config as appConfig } from '@/config/env';
import { superpositionClient } from '@/services/superpositionClient';
import { sudoQueryService } from '@/services/hyperAnalytics/sudoQueryService';
import { db } from '@/database/client';

function escapeQueryForUserInput(query: string): string {
  if (!query) return query;

  // Strip leading/trailing whitespace
  const trimmed = query.trim();

  // If the entire query is only special characters with no alphanumeric content,
  // return empty string to avoid Vespa parse errors
  if (!/[a-zA-Z0-9]/.test(trimmed)) {
    return '';
  }

  return trimmed
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/!/g, '\\!')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/:/g, '\\:')
    .replace(/\*/g, '\\*')
    .replace(/\?/g, '\\?')
    .replace(/\|/g, '\\|')
    .replace(/&/g, '\\&')
    .replace(/~/g, '\\~')
    .replace(/\^/g, '\\^')
    .replace(/\$/g, '\\$')
    .replace(/'/g, "\\'");
}

/**
 * Optional debug hook: when supplied, searchVespa calls back with the actual
 * YQL string and the full Vespa request payload (including bound `@placeholder`
 * params and ranking inputs) for every Vespa hit — exact pass, fuzzy fallback
 * pass, etc. Lets the searchHandler bubble those up to callers that opted into
 * `includeDebugInfo=true` so e.g. claw-auth's kb-search/spaces-search can log
 * the exact YQL to disk for offline replay.
 */
export interface VespaSearchDebugInfo {
  stage: "exact" | "fuzzy-fallback";
  yql: string;
  vespaParams: Record<string, unknown>;
}

interface SearchOptions {
  rankProfile?: string;
  offset?: number;
  limit?: number;
  chunkLimit?: number;
  groupBy?: string;
  sort?: string;
  nativeRankThreshold?: number;
  workspaceId?: string;
  slack?: SlackFilters;
  ticket?: TicketFilters;
  file?: FileFilters;
  meeting?: MeetingFilters;
  mail?: MailFilters;
  call?: CallFilters;
  prefixBoostWeight?: number;
  presentationSummary?: string;
  captureDebug?: (info: VespaSearchDebugInfo) => void;
  // Display name(s) of scoped mention chips, highlighted as exact phrases in results (not in YQL).
  mentionHighlights?: string[];
}

export interface ILogger {
  info(message: string): void;
  error(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
  child(options: { module: string }): ILogger;
}

interface VespaDependencies {
  logger: ILogger;
}


export class SearchService {
  private logger: ILogger;
  private vespa: vespaClient;
  private yqlBuilder: YqlBuilder;

  constructor(vespaClient: VespaClient , dependencies : VespaDependencies) {
    this.logger = dependencies.logger.child({ module: 'vespa-search' });
    this.vespa = vespaClient;
    this.yqlBuilder = new YqlBuilder();
  }

  /**
   * Search the xyne-apps catalog (`app` schema), scoped to one of the three Apps
   * views (Installed / Org / Marketplace):
   *   - 'installed'   → apps installed in the caller's workspace.
   *   - 'org'         → ORG-scoped apps owned by the caller's org.
   *   - 'marketplace' → GLOBAL apps across all orgs.
   *
   * Hybrid lexical + (for queries > 3 chars) semantic. Matches on name,
   * description, creator, and owning org name (so a cross-org marketplace app is
   * findable by its org, e.g. "Juspay" — mirroring the UI's "Created by" fallback).
   * No per-user ACL — visibility is gated by the XYNE-APPS resource permission at
   * the route. Install state is resolved from the DB (source of truth), scoped to
   * the caller's workspace via the install user's workspaceId.
   */
  async searchApps(
    query: string,
    workspaceId: string | undefined,
    opts: {
      view: 'installed' | 'org' | 'marketplace';
      orgId?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<{
    results: Array<{
      docId: string;
      name: string;
      description: string;
      createdBy: string;
      orgId: string;
      orgName: string;
      scope: string;
      version: number;
      createdAt: number;
      relevance: number;
      installed: boolean;
      installedAppId: string | null;
      installedVersion: number | null;
      webhookUrl: string | null;
      botUserId: string | null;
    }>;
    total: number;
  }> {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const view = opts.view;
    const searchQuery = escapeQueryForUserInput(query);
    if (!searchQuery) return { results: [], total: 0 };

    // Workspace-scoped installs (install user's workspaceId — same join as
    // installedAppsRepository.findByWorkspaceId). Drives both the Installed-view
    // corpus filter and the per-hit install state across all views.
    const myInstalls = workspaceId
      ? await db.installedApps.findMany({
          where: { user: { workspaceId } },
          select: { id: true, appId: true, userId: true, webhookUrl: true, version: true },
        })
      : [];
    const installByApp = new Map<
      string,
      { installedAppId: string; userId: string; webhookUrl: string | null; version: number }
    >();
    for (const inst of myInstalls) {
      if (!installByApp.has(inst.appId)) {
        installByApp.set(inst.appId, {
          installedAppId: inst.id,
          userId: inst.userId,
          webhookUrl: inst.webhookUrl ?? null,
          version: inst.version,
        });
      }
    }

    // Installed view with no installs → nothing to search.
    const installedAppIds = Array.from(installByApp.keys());
    if (view === 'installed' && installedAppIds.length === 0) {
      return { results: [], total: 0 };
    }

    const useSemantic = query.trim().length > 3;

    const { yql, params } = this.yqlBuilder.buildAppYql({
      view,
      orgId: opts.orgId,
      installedAppIds,
    });
    // Lexical retrieval; the embedding (passed below when useSemantic) only
    // re-ranks via closeness in the rank-profile — it does not expand the match set.

    const payload: Record<string, unknown> = {
      yql,
      query: searchQuery,
      ...params,
      hits: limit,
      offset,
      'ranking.profile': 'default_native',
      'input.query(alpha)': 0.35,
      timeout: '15s',
      'presentation.summary': 'lean',
      ...(useSemantic ? { 'input.query(e)': 'embed(hf-embedder, @query)' } : {}),
    };

    try {
      const response = await this.vespa.search<VespaSearchResponse>(payload as any);
      const root = (response?.root ?? {}) as any;
      const total = root?.fields?.totalCount ?? 0;
      const children = (root?.children ?? []) as Array<any>;
      const hits = children
        .map((c) => ({
          docId: c?.fields?.docId ?? '',
          name: c?.fields?.name ?? '',
          description: c?.fields?.description ?? '',
          createdBy: c?.fields?.createdBy ?? '',
          orgId: c?.fields?.orgId ?? '',
          orgName: c?.fields?.orgName ?? '',
          scope: c?.fields?.scope ?? '',
          version: c?.fields?.version ?? 0,
          createdAt: c?.fields?.createdAt ?? 0,
          relevance: c?.relevance ?? 0,
        }))
        .filter((r) => r.docId);

      const results = hits.map((h) => {
        const inst = installByApp.get(h.docId);
        return {
          ...h,
          installed: !!inst,
          installedAppId: inst?.installedAppId ?? null,
          installedVersion: inst?.version ?? null,
          webhookUrl: inst?.webhookUrl ?? null,
          botUserId: inst?.userId ?? null,
        };
      });
      return { results, total };
    } catch (error) {
      this.logger.error(`App search failed: ${getErrorMessage(error)}`);
      return { results: [], total: 0 };
    }
  }

  /**
   * Generic Vespa search service
   */
  searchVespa = async (
    query: string,
    userId: string,
    app: string[],
    options: SearchOptions = {},
    searchId?: string,
  ): Promise<VespaSearchResponse> => {
    if (searchId) {
      this.logger = this.logger.child({ module : `vespa-search, ${searchId}` });

    }
    try {
      const {
        rankProfile = RankProfile.nativeRank,
        offset = 0,
        limit = 20,
        chunkLimit = 6,
        groupBy = 'docType',
        sort,
        nativeRankThreshold = config.nativeRankThreshold,
        slack = {},
        ticket = {},
        file = {},
        meeting = {},
        mail = {},
        call = {},
        prefixBoostWeight = 0.2,
        presentationSummary,
        mentionHighlights = [],
        workspaceId,
        captureDebug,
      } = options;

      // Derive workspaceId from userId when not explicitly provided
      const effectiveWorkspaceId = workspaceId
        || (await db.user.findUnique({ where: { id: userId }, select: { workspaceId: true } }))?.workspaceId
        || undefined;

      // Exact-match mode: the user wrapped the whole query in double quotes (e.g. "quarterly
      // report") to match it as a strict adjacent-term phrase (grammar:"phrase" + rules.off),
      // with no fuzzy/semantic broadening. Detect on the raw query, before any keyword stripping.
      const rawTrimmedQuery = query?.trim() ?? '';
      const isExactMatch =
        rawTrimmedQuery.length >= 2 &&
        rawTrimmedQuery.startsWith('"') &&
        rawTrimmedQuery.endsWith('"') &&
        rawTrimmedQuery.slice(1, -1).trim().length > 0;

      // Parse time keywords from query — skipped for exact match so a quoted word like
      // "yesterday" is searched literally instead of being consumed as a time filter.
      const parsedQuery: ParsedTimeQuery = parseTimeKeywords(isExactMatch ? '' : query);
      const searchQuery = isExactMatch
        ? rawTrimmedQuery.slice(1, -1).trim()
        : parsedQuery.cleanedQuery || query;
      const freshnessWeight = parsedQuery.config?.freshnessWeight ?? 0.0;
      const filteringWeight = parsedQuery.config?.filteringWeight ?? 0.0;
      const timeRangeStart = parsedQuery.config?.timeRange.from ?? 0;
      const timeRangeEnd = parsedQuery.config?.timeRange.to ?? Date.now();

      if (parsedQuery.hasTimeKeyword && parsedQuery.config) {
        this.logger.info(
          `Time keyword detected: "${parsedQuery.config.keyword}" - ` +
          `FreshnessWeight: ${freshnessWeight}, FilteringWeight: ${filteringWeight}, ` +
          `Range: ${formatTimeRange(parsedQuery.config.timeRange)}`
        );
      }

      // Get schemas for the apps
      const appSchemaMap = this.yqlBuilder.getAppSchemaMapping(app);
      let allSchemas = Array.from(new Set(Object.values(appSchemaMap).flat()));
      //const isGrouped = groupBy && (app.length && app.length != 1);
      if (allSchemas.length === 0) {
        throw new Error(`No valid schemas found for apps: ${app.join(', ')}`);
      }

      // Prune the queried schemas (`from sources ...`) to those matching the requested
      // docType filters. This is result-preserving — the docType WHERE clause already
      // excludes other schemas' docs — and it lets schema-specific rank profiles
      // (e.g. `personalized` on chat_message, `semantic_ranking` on ticket) validate,
      // since Vespa rejects a rank profile missing from any queried schema.
      const docTypeToSchema: Partial<Record<VespaDocType, string>> = {
        [VespaDocType.MESSAGE]: messageSchema,
        [VespaDocType.ATTACHMENT]: attachmentSchema,
        [VespaDocType.CHANNEL]: channelSchema,
        [VespaDocType.TICKET]: ticketSchema,
        [VespaDocType.FILE]: fileSchema,
        [VespaDocType.USER]: userSchema,
        [VespaDocType.MAIL]: mailSchema,
        [VespaDocType.CALL]: callSchema,
      };
      const docTypesOf = (f: { docType?: string[] }): string[] => f?.docType ?? [];
      const requestedDocTypes = [
        ...docTypesOf(slack),
        ...docTypesOf(ticket as { docType?: string[] }),
        ...docTypesOf(file as { docType?: string[] }),
        ...docTypesOf(mail as { docType?: string[] }),
        ...docTypesOf(call as { docType?: string[] }),
      ];
      if (requestedDocTypes.length > 0) {
        const wantedSchemas = new Set(
          requestedDocTypes
            .map((t) => docTypeToSchema[t as VespaDocType])
            .filter(Boolean) as string[],
        );
        const prunedSchemas = allSchemas.filter((s) => wantedSchemas.has(s));
        if (prunedSchemas.length > 0) {
          allSchemas = prunedSchemas;
        }
      }

      const queryWordCount = searchQuery?.trim().split(/\s+/).filter(Boolean).length || 0;
      // Fetch personalization weights if using personalized rank profile
      let channelWeights = {};
      let userWeights = {};
      // For mail's involvement rank terms (from/to hold email addresses)
      let personalizationUserEmail: string | undefined;

      if (rankProfile === RankProfile.personalizedRank) {
        try {
          const userDoc = await this.vespa.getDocument({docId:userId,schema:userSchema,namespace:config.namespace});
          channelWeights = userDoc?.fields?.channelWeights || {};
          userWeights = userDoc?.fields?.userWeights || {};
          personalizationUserEmail = userDoc?.fields?.email || undefined;
          if (!personalizationUserEmail) {
            this.logger.warn(`No email on Vespa user doc ${userId}; mail involvement rank terms skipped`);
          }
          this.logger.info(`Fetched personalization weights for user ${userId}`);
        } catch (error) {
          this.logger.warn(
            `Failed to fetch user personalization weights for user ${userId}: ${getErrorMessage(error)}. Using empty weights.`
          );
          // Continue with empty weights for graceful degradation
        }
      }

      const buildPayload = (useFuzzy: boolean, useSemanticAnyway: boolean, wsId: string | undefined) => {
        const escapedQuery = escapeQueryForUserInput(searchQuery);
        const effectiveQuery = escapedQuery || '*';
        const { yql, params: boundParams } = this.yqlBuilder.buildYql(
          effectiveQuery,
          allSchemas,
          limit,
          app,
          groupBy,
          slack,
          ticket,
          file,
          meeting,
          userId,
          mail,
          call,
          useFuzzy,
          useSemanticAnyway,
          wsId,
          sort,
          isExactMatch,
          rankProfile,
          personalizationUserEmail,
        );

        const hasQuery = !!(searchQuery && searchQuery.trim());
        const queryLength = searchQuery?.trim().length || 0;
        const shouldEmbed = hasQuery && queryLength > 3 && (useSemanticAnyway || useFuzzy);

        return {
          yql,
          query: effectiveQuery,
          // Spread before the reserved keys below so those always win on collision; yql/query above
          // are safe since bind() names placeholders `<field>_<index>`, never a reserved key.
          ...boundParams,
          hits: limit,
          offset,
          ...(useFuzzy ? { "ranking.profile": RankProfile.fuzzyRank } : { "ranking.profile": rankProfile }),
          "input.query(alpha)": 0.5,
          "input.query(chunk_limit)": chunkLimit,
          "input.query(query_length)": queryWordCount,
          timeout: '30s',
          ...(shouldEmbed ? { 'input.query(e)': 'embed(hf-embedder, @query)' } : {}),
          ...(useFuzzy ? { "gram.match": "weakAnd" } : {}),
          "input.query(freshness_weight)": freshnessWeight,
          "input.query(filtering_weight)": filteringWeight,
          "input.query(time_from)": timeRangeStart,
          "input.query(time_to)": timeRangeEnd,
          "ranking.listFeatures": true,
          ...(presentationSummary ? { "presentation.summary": presentationSummary } : {}),
          tracelevel: 0,
          // Exact match turns off the default searchrules.sr rewriting (stopword removal + ranking
          // boosts): stripping a word like "is"/"the" mid-query silently breaks phrase adjacency.
          ...(isExactMatch ? { "rules.off": true } : {}),
          ...(rankProfile === RankProfile.personalizedRank && {
            "input.query(channel_personalization_weights)": channelWeights,
            "input.query(user_personalization_weights)": userWeights,
            "input.query(saturation_point)": 100.0,
          }),
        };
      };

      // Execute search
      // Fetch feature flags from Superposition
      const useSemanticAnyway = await superpositionClient.getBooleanValue(
        'vespa_search_use_semantic_anyway',
        true,
        {}
      );
      const newFallbackMethod = await superpositionClient.getBooleanValue(
        'vespa_search_new_fallback_method',
        false,
        {}
      );
      // Passes effectiveWorkspaceId to YqlBuilder, so the top-level `workspaceId contains
      // @ws` guard bounds the `user`/`transcript` branches to the caller's workspace.
      // Those two branches carry no per-app guard of their own, so this is the only thing
      // scoping them; it defaults on and the Superposition flag exists to turn it off, not
      // to turn it on. A document ingested without a workspaceId will not match while this
      // is enabled, so the schema has to be backfilled before the results are complete.
      const enableWorkspaceFiltering = await superpositionClient.getBooleanValue(
        'enableWorkSpaceFiltering',
        true,
        {}
      );
      const payload = buildPayload(false, useSemanticAnyway, enableWorkspaceFiltering ? effectiveWorkspaceId : undefined);
      this.logger.info(`Payload: ${JSON.stringify(payload)}`);
      if (captureDebug) {
        captureDebug({
          stage: "exact",
          yql: payload.yql as string,
          vespaParams: payload as Record<string, unknown>,
        });
      }

      const totalStartTime = Date.now();
      const exactStartTime = Date.now();
      let response = await this.vespa.search<VespaSearchResponse>(payload);
      const exactDuration = Date.now() - exactStartTime;

       // Filter by nativerank if enabled
       // Skip nativeRank filtering for filter-only searches (no query text)
       // nativeRank is based on text matching - meaningless without a query
      let textMatchRescuedIds = new Set<string>();
       if (nativeRankThreshold > 0 && searchQuery?.trim()) {
        const filtered = filterByNativeRank(response, nativeRankThreshold , this.logger, {
          query: searchQuery,
        });
        response = filtered.response;
        textMatchRescuedIds = filtered.rescuedIds;
      }

      const exactResultCount = response.root?.children?.length || 0;
      const expectedCount = limit - offset;
      this.logger.info(`Exact search returned ${exactResultCount} results, expected ${expectedCount}`);

      // Hits kept only by the ticket text-match rescue scored below the nativeRank threshold,
      // so they are not evidence that the exact pass did well. Counting them would push
      // exactResultCount over expectedCount and silently skip the 3-gram fuzzy fallback that
      // recovers typo and prefix queries. Clamped because root.children are group nodes when
      // grouping is on, while rescued ids are collected from the hits nested inside them.
      const strongExactResultCount = Math.max(0, exactResultCount - textMatchRescuedIds.size);

      const isTranscriptOnly = app.length === 1 && app[0].toLowerCase() === 'transcript';
      const isFileSearch = app.some(a => a.toLowerCase() === 'file');
      const oldFallback = strongExactResultCount < expectedCount && searchQuery?.trim() && !isTranscriptOnly && !isFileSearch

      const FALLBACK_SCORE_THRESHOLD = await superpositionClient.getNumberValue(
        'vespa_fallback_score_threshold',
        0.1,
        {}
      );
      const MIN_GOOD_RESULTS = await superpositionClient.getNumberValue(
        'vespa_min_good_results',
        5,
        {}
      );
      // Same reasoning as strongExactResultCount: a rescued hit can carry a passable
      // relevance from the vector half of the profile despite a zero nativeRank, so it must
      // not count toward "we already have enough good results".
      const goodResults = response.root?.children?.filter(
        child =>
          !textMatchRescuedIds.has(String(child.id ?? '')) &&
          (child.relevance ?? 0) >= FALLBACK_SCORE_THRESHOLD
      ) ?? [];

      const newFallback =
        searchQuery?.trim() &&
        !isTranscriptOnly &&
        !isFileSearch &&
        goodResults.length < MIN_GOOD_RESULTS;


      // Exact-match queries never fall back to fuzzy — 3-gram fuzzy would defeat "exact".
      const needsFallback = !isExactMatch && (newFallbackMethod ? newFallback : oldFallback);
      let fallbackDuration = 0

      if(needsFallback){
        const fallbackStartTime = Date.now();
        const fallbackResult = await executeFuzzyFallback(
        response,
        async () => {
          const fuzzyPayload = buildPayload(true, useSemanticAnyway, enableWorkspaceFiltering ? effectiveWorkspaceId : undefined);
          this.logger.info(`Fuzzy Search Payload: ${JSON.stringify(fuzzyPayload)}`);
          if (captureDebug) {
            captureDebug({
              stage: "fuzzy-fallback",
              yql: fuzzyPayload.yql as string,
              vespaParams: fuzzyPayload as Record<string, unknown>,
            });
          }
          return this.vespa.search<VespaSearchResponse>(fuzzyPayload);
        },
        
        {
          searchQuery,
          limit,
          prefixBoostWeight,
          mentionNames: mentionHighlights,
        },
        this.logger
      );

      response = fallbackResult.mergedResponse;
      fallbackDuration = Date.now() - fallbackStartTime;

      this.logger.info(
        `Fallback completed: ${fallbackResult.exactCount} exact + ${fallbackResult.fuzzyCount} fuzzy results`
      );
    }

      // Re-bold the mention name as one phrase: strip existing <hi> tags (our per-token fuzzy pass
      // fragments multi-word names) and re-apply highlightText. Rebuilt immutably.
      if (mentionHighlights.length && response.root?.children) {
        response.root.children = response.root.children.map((child) => {
          const text = (child.fields as { text?: unknown }).text;
          if (typeof text !== 'string' || !text) return child;
          const highlighted = highlightText(text.replace(/<\/?hi>/gi, ''), searchQuery ?? '', mentionHighlights);
          return { ...child, fields: { ...child.fields, text: highlighted } };
        });
      }

      
      if (appConfig.deskTicketDebug) {
        const hitIdentities = response.root?.children?.filter((child: any) =>
          !String(child.id ?? '').startsWith('group:')
        ).map((child: any) => {
          const [, , hitSchema, , hitDocId] = String(child.id ?? '').split(':');
        
          const matchFeatures = (child.fields?.matchfeatures ?? {}) as Record<string, unknown>;
          const scores = Object.fromEntries(
            Object.entries(matchFeatures).filter(([, v]) => typeof v === 'number')
          );
          return {
            docId: child.fields?.docId ?? hitDocId,
            schema: hitSchema ?? child.fields?.sddocname,
            xyneId: child.fields?.xyneId,
            threadId: child.fields?.threadId,
            relevance: child.relevance,
            scores,
          };
        }) || [];

        this.logger.info(
          `[DESK_DEBUG_SEARCH] ${JSON.stringify({
            searchId,
            userId,
            apps: app.join(','),
            rankProfile,
            hitCount: hitIdentities.length,
            hits: hitIdentities,
          })}`
        );
      }

      if (process.env.NODE_ENV === 'development') {
        // Log only specific fields
        const simplifiedResults = response.root?.children?.map((child: any) => ({
          id: child.fields?.docId,
          context: child.fields?.text,
          relevanceScore: child.relevance,
          matchfeatures: child.fields?.matchfeatures,
        })) || [];

        this.logger.info(`Results: ${JSON.stringify(simplifiedResults)}`);
      }

      const totalDuration = Date.now() - totalStartTime;

      // Track search metrics to sudo-query
      sudoQueryService.identify({ id: userId });
      sudoQueryService.track('vespa_latency_metrics', {
        ts: Date.now(),
        searchId: searchId || '',
        userId,
        apps: app.join(','),
        searchQuery: searchQuery || '',
        queryLength: searchQuery?.trim()?.split(/\s+/)?.filter(Boolean)?.length || 0,
        rankProfile,
        useSemanticAnyway,
        useFuzzy: false,
        exactResultCount,
        expectedCount,
        fallBack: needsFallback,
        newFallbackMethod: newFallbackMethod,
        exactDuration,
        fallbackDuration,
        totalDuration,
        hasTimeKeyword: parsedQuery.hasTimeKeyword,
      });
      return response;

    } catch (error) {
      this.logger.error(`Error in searchVespa with query "${query}": ${getErrorMessage(error)}`);
      throw error;
    }
  };
}
