import {
  parseTimeKeywords,
  formatTimeRange,
  type ParsedTimeQuery,
} from '../utils/timeKeywordParser';
import type vespaClient from '../client';
import {
  type VespaSearchResponse,
  RankProfile,
  userSchema,
} from '../types';
import VespaClient from '../client/vespaClient';
import { getErrorMessage } from '../utils';
import config from '../config';
import { YqlBuilder, type SlackFilters, type TicketFilters, type FileFilters, type MeetingFilters } from '../utils/YqlBuilder';
import {  
  filterByNativeRank,
} from '../utils/responseProcessor';
import { executeFuzzyFallback } from '../utils/fallback';

interface SearchOptions {
  rankProfile?: string;
  offset?: number;
  limit?: number;
  groupBy?: string;
  nativeRankThreshold?: number;
  slack?: SlackFilters;
  ticket?: TicketFilters;
  file?: FileFilters;
  meeting?: MeetingFilters;
  prefixBoostWeight?: number;
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
        groupBy = 'docType',
        nativeRankThreshold = config.nativeRankThreshold,
        slack = {},
        ticket = {},
        file = {},
        meeting = {},
        prefixBoostWeight = 0.2,
      } = options;

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
      const allSchemas = Array.from(new Set(Object.values(appSchemaMap).flat()));
      //const isGrouped = groupBy && (app.length && app.length != 1);
      if (allSchemas.length === 0) {
        throw new Error(`No valid schemas found for apps: ${app.join(', ')}`);
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

      const buildPayload = (useFuzzy: boolean) => {
        const yql = this.yqlBuilder.buildYql(
          searchQuery,
          allSchemas,
          limit,
          app,
          groupBy,
          slack,
          ticket,
          file,
          meeting,
          userId,
          useFuzzy
        );

        return {
          yql,
          query: searchQuery || '',
          hits: limit,
          offset,
          ...(useFuzzy ? { "ranking.profile": RankProfile.fuzzyRank } : { "ranking.profile": rankProfile }),
          "input.query(alpha)": 0.5,
          "input.query(query_length)": queryWordCount,
          timeout: '30s',
          ...(query && query.trim() ? { 'input.query(e)': 'embed(@query)' } : {}),
          ...(useFuzzy ? { "gram.match": "weakAnd" } : {}),
          "input.query(freshness_weight)": freshnessWeight,
          "input.query(filtering_weight)": filteringWeight,
          "input.query(time_from)": timeRangeStart,
          "input.query(time_to)": timeRangeEnd,
          "ranking.listFeatures": true,
          tracelevel: 0,
          ...(rankProfile === RankProfile.personalizedRank && {
            "input.query(channel_personalization_weights)": channelWeights,
            "input.query(user_personalization_weights)": userWeights,
            "input.query(saturation_point)": 100.0,
          }),
        };
      };

      // Execute search
      const payload = buildPayload(false);
      this.logger.info(`Payload: ${JSON.stringify(payload)}`);

      let response = await this.vespa.search<VespaSearchResponse>(payload);
      
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
      if(exactResultCount < expectedCount && searchQuery?.trim() && !isTranscriptOnly){
      const fallbackResult = await executeFuzzyFallback(
        response,
        async () => {
          const fuzzyPayload = buildPayload(true);
          this.logger.info(`Fuzzy Search Payload: ${JSON.stringify(fuzzyPayload)}`);
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
      return response;

    } catch (error) {
      this.logger.error(`Error in searchVespa with query "${query}": ${getErrorMessage(error)}`);
      throw error;
    }
  };
}
