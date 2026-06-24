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
} from '../types';
import VespaClient from '../client/vespaClient';
import { getErrorMessage } from '../utils';
import config from '../config';
import { YqlBuilder, type SlackFilters, type TicketFilters, type FileFilters, type MeetingFilters, type MailFilters } from '../utils/YqlBuilder';
import {
  filterByNativeRank,
} from '../utils/responseProcessor';
import { executeFuzzyFallback } from '../utils/fallback';
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
  nativeRankThreshold?: number;
  workspaceId?: string;
  slack?: SlackFilters;
  ticket?: TicketFilters;
  file?: FileFilters;
  meeting?: MeetingFilters;
  mail?: MailFilters;
  prefixBoostWeight?: number;
  presentationSummary?: string;
  captureDebug?: (info: VespaSearchDebugInfo) => void;
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
        nativeRankThreshold = config.nativeRankThreshold,
        slack = {},
        ticket = {},
        file = {},
        meeting = {},
        mail = {},
        prefixBoostWeight = 0.2,
        presentationSummary,
        workspaceId,
        captureDebug,
      } = options;

      // Derive workspaceId from userId when not explicitly provided
      const effectiveWorkspaceId = workspaceId
        || (await db.user.findUnique({ where: { id: userId }, select: { workspaceId: true } }))?.workspaceId
        || undefined;

      // Parse time keywords from query
      const parsedQuery: ParsedTimeQuery = parseTimeKeywords(query);
      const searchQuery = parsedQuery.cleanedQuery || query;
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
      };
      const docTypesOf = (f: { docType?: string[] }): string[] => f?.docType ?? [];
      const requestedDocTypes = [
        ...docTypesOf(slack),
        ...docTypesOf(ticket as { docType?: string[] }),
        ...docTypesOf(file as { docType?: string[] }),
        ...docTypesOf(mail as { docType?: string[] }),
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

      if (rankProfile === RankProfile.personalizedRank) {
        try {
          const userDoc = await this.vespa.getDocument({docId:userId,schema:userSchema,namespace:config.namespace});
          channelWeights = userDoc?.fields?.channelWeights || {};
          userWeights = userDoc?.fields?.userWeights || {};
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
          useFuzzy,
          useSemanticAnyway,
          wsId,
        );

        const hasQuery = !!(searchQuery && searchQuery.trim());
        const queryLength = searchQuery?.trim().length || 0;
        const shouldEmbed = hasQuery &&  queryLength > 3 &&(useSemanticAnyway || useFuzzy);

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
          ...(shouldEmbed ? { 'input.query(e)': 'embed(@query)' } : {}),
          ...(useFuzzy ? { "gram.match": "weakAnd" } : {}),
          "input.query(freshness_weight)": freshnessWeight,
          "input.query(filtering_weight)": filteringWeight,
          "input.query(time_from)": timeRangeStart,
          "input.query(time_to)": timeRangeEnd,
          "ranking.listFeatures": true,
          ...(presentationSummary ? { "presentation.summary": presentationSummary } : {}),
          tracelevel: 0,
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
      const enableWorkspaceFiltering = await superpositionClient.getBooleanValue(
        'enableWorkSpaceFiltering',
        false,
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
       if (nativeRankThreshold > 0 && searchQuery?.trim()) {
        response = filterByNativeRank(response, nativeRankThreshold , this.logger);
      }

      const exactResultCount = response.root?.children?.length || 0;
      const expectedCount = limit - offset;
      this.logger.info(`Exact search returned ${exactResultCount} results, expected ${expectedCount}`);
      
      const isTranscriptOnly = app.length === 1 && app[0].toLowerCase() === 'transcript';

      const isFileSearch = app.some(a => a.toLowerCase() === 'file');
      const oldFallback = exactResultCount < expectedCount && searchQuery?.trim() && !isTranscriptOnly && !isFileSearch

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
      const goodResults = response.root?.children?.filter(
        child => (child.relevance ?? 0) >= FALLBACK_SCORE_THRESHOLD
      ) ?? [];

      const newFallback =
        searchQuery?.trim() &&
        !isTranscriptOnly &&
        !isFileSearch &&
        goodResults.length < MIN_GOOD_RESULTS;


      const needsFallback = newFallbackMethod ? newFallback : oldFallback;
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
        },
        this.logger
      );

      response = fallbackResult.mergedResponse;
      fallbackDuration = Date.now() - fallbackStartTime;

      this.logger.info(
        `Fallback completed: ${fallbackResult.exactCount} exact + ${fallbackResult.fuzzyCount} fuzzy results`
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
