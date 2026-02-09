/**
 * Time Keyword Parser for Dynamic Freshness Boosting
 * 
 * 
 * This enables "smart" search where queries like "deployment issues today"
 * will boost today's messages to the top while still showing older results.
 */

// ============== Types ==============

export interface TimeRange {
  from: number;  // Unix timestamp in milliseconds
  to: number;    // Unix timestamp in milliseconds
}

export interface TimeKeywordConfig {
  keyword: string;
  freshnessWeight: number; 
  filteringWeight: number;    // 0.0 to 1.0 - boost factor for docs in time range
  timeRange: TimeRange;
  rankingProfile: string;       // Vespa ranking profile to use
}

export interface ParsedTimeQuery {
  originalQuery: string;
  cleanedQuery: string;         // Query with time keywords removed
  hasTimeKeyword: boolean;
  config: TimeKeywordConfig | null;
}

// ============== Constants ==============

/**
 * Freshness weight constants for different time keywords
 * Higher values = stronger boost for documents in that time range
 */
export const FRESHNESS_WEIGHTS = {
  // High urgency - strong freshness boost
  TODAY: 0.0,
  THIS_MORNING: 0.0,
  THIS_AFTERNOON: 0.0,
  LAST_HOUR: 0.0,
  LAST_24_HOURS: 0.0,

  // Medium urgency
  YESTERDAY: 0.0,
  RECENT: 0.2,
  RECENTLY: 0.2,
  NEW: 0.2,
  THIS_WEEK: 0.0,
  LAST_WEEK: 0.0,
  LAST_7_DAYS: 0.0,
  CURRENT: 0.2,
  CURRENTLY: 0.2,
  LATEST: 0.2,
  LAST: 0.2,
  // Lower urgency
  THIS_MONTH: 0.0,
  LAST_MONTH: 0.0,
  LAST_30_DAYS: 0.0,
  
  // Default (no time keyword)
  DEFAULT: 0.0,
} as const;

export const FILTERING_WEIGHTS = {
  // High urgency - strong freshness boost
  TODAY: 0.8,
  THIS_MORNING: 0.8,
  THIS_AFTERNOON: 0.8,
  LAST_HOUR: 0.8,
  LAST_24_HOURS: 0.8,
  
  // Medium urgency
  YESTERDAY: 0.8,
  RECENT: 0.2,
  RECENTLY: 0.2,
  NEW: 0.2,
  THIS_WEEK: 0.8,
  LAST_WEEK: 0.8,
  LAST_7_DAYS: 0.8,
  CURRENT: 0.2,
  CURRENTLY: 0.2,
  LATEST: 0.2,
  LAST: 0.2,
  // Lower urgency
  THIS_MONTH: 0.8,
  LAST_MONTH: 0.8,
  LAST_30_DAYS: 0.8,
  
  // Default (no time keyword)
  DEFAULT: 0.0,
} as const;

/**
 * Ranking profile names - must match Vespa schema
 */
export const RANKING_PROFILES = {
  DEFAULT: 'default_native',
} as const;

// ============== Date Helper Functions (UTC-based) ==============

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setUTCHours(23, 59, 59, 999);
  return result;
}

function setHours(date: Date, hours: number): Date {
  const result = new Date(date);
  result.setUTCHours(hours, 0, 0, 0);
  return result;
}

function subDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() - days);
  return result;
}

function subHours(date: Date, hours: number): Date {
  const result = new Date(date);
  result.setUTCHours(result.getUTCHours() - hours);
  return result;
}

function startOfWeek(date: Date): Date {
  const result = new Date(date);
  const day = result.getUTCDay();
  const diff = result.getUTCDate() - day + (day === 0 ? -6 : 1); // Monday as start
  result.setUTCDate(diff);
  return startOfDay(result);
}

function startOfMonth(date: Date): Date {
  const result = new Date(date);
  result.setUTCDate(1);
  return startOfDay(result);
}

// ============== Time Keyword Definitions ==============

/**
 * Time keyword definitions with their freshness weights and time ranges
 * Each keyword maps to a function that returns the config based on current time
 */
const TIME_KEYWORD_DEFINITIONS: Record<string, (now: Date) => Omit<TimeKeywordConfig, 'keyword'>> = {
  // High urgency keywords
  'today': (now) => ({
    freshnessWeight: FRESHNESS_WEIGHTS.TODAY,
    filteringWeight: FILTERING_WEIGHTS.TODAY,
    timeRange: {
      from: startOfDay(now).getTime(),
      to: endOfDay(now).getTime(),
    },
    rankingProfile: RANKING_PROFILES.DEFAULT,
  }),
  
  'this morning': (now) => ({
    freshnessWeight: FRESHNESS_WEIGHTS.THIS_MORNING,
    filteringWeight: FILTERING_WEIGHTS.THIS_MORNING,
    timeRange: {
      from: startOfDay(now).getTime(),
      to: Math.min(now.getTime(), setHours(now, 12).getTime()),
    },
    rankingProfile: RANKING_PROFILES.DEFAULT,
  }),
  
  'this afternoon': (now) => ({
    freshnessWeight: FRESHNESS_WEIGHTS.THIS_AFTERNOON,
    filteringWeight: FILTERING_WEIGHTS.THIS_AFTERNOON,
    timeRange: {
      from: setHours(startOfDay(now), 12).getTime(),
      to: endOfDay(now).getTime(),
    },
    rankingProfile: RANKING_PROFILES.DEFAULT,
  }),
  
  'last hour': (now) => ({
    freshnessWeight: FRESHNESS_WEIGHTS.LAST_HOUR,
    filteringWeight: FILTERING_WEIGHTS.LAST_HOUR,
    timeRange: {
      from: subHours(now, 1).getTime(),
      to: now.getTime(),
    },
    rankingProfile: RANKING_PROFILES.DEFAULT,
  }),
  
  'last 24 hours': (now) => ({
    freshnessWeight: FRESHNESS_WEIGHTS.LAST_24_HOURS,
    filteringWeight: FILTERING_WEIGHTS.LAST_24_HOURS,
    timeRange: {
      from: subHours(now, 24).getTime(),
      to: now.getTime(),
    },
    rankingProfile: RANKING_PROFILES.DEFAULT,
  }),
  
  'yesterday': (now) => ({
    freshnessWeight: FRESHNESS_WEIGHTS.YESTERDAY,
    filteringWeight: FILTERING_WEIGHTS.YESTERDAY,
    timeRange: {
      from: startOfDay(subDays(now, 1)).getTime(),
      to: endOfDay(subDays(now, 1)).getTime(),
    },
    rankingProfile: RANKING_PROFILES.DEFAULT,
  }),
  
  // Medium urgency keywords
  'recent': (now) => ({
    freshnessWeight: FRESHNESS_WEIGHTS.RECENT,
    filteringWeight: FILTERING_WEIGHTS.RECENT,
    timeRange: {
      from: subDays(now, 30).getTime(),
      to: now.getTime(),
    },
    rankingProfile: RANKING_PROFILES.DEFAULT,
  }),
  
  'recently': (now) => ({
    freshnessWeight: FRESHNESS_WEIGHTS.RECENTLY,
    filteringWeight: FILTERING_WEIGHTS.RECENTLY,
    timeRange: {
      from: subDays(now, 30).getTime(),
      to: now.getTime(),
    },
    rankingProfile: RANKING_PROFILES.DEFAULT,
  }),
  
  'new': (now) => ({
    freshnessWeight: FRESHNESS_WEIGHTS.NEW,
    filteringWeight: FILTERING_WEIGHTS.NEW,
    timeRange: {
      from: subDays(now, 30).getTime(),
      to: now.getTime(),
    },
    rankingProfile: RANKING_PROFILES.DEFAULT,
  }),
  'currently': (now) => ({
    freshnessWeight: FRESHNESS_WEIGHTS.CURRENTLY,
    filteringWeight: FILTERING_WEIGHTS.CURRENTLY,
    timeRange: {
      from: subDays(now, 30).getTime(),
      to: now.getTime(),
    },
    rankingProfile: RANKING_PROFILES.DEFAULT,
  }),
   'current': (now) => ({
    freshnessWeight: FRESHNESS_WEIGHTS.CURRENT,
    filteringWeight: FILTERING_WEIGHTS.CURRENT,
    timeRange: {
      from: subDays(now, 30).getTime(),
      to: now.getTime(),
    },
    rankingProfile: RANKING_PROFILES.DEFAULT,
  }),
   'last': (now) => ({
    freshnessWeight: FRESHNESS_WEIGHTS.LAST,
    filteringWeight: FILTERING_WEIGHTS.LAST,
    timeRange: {
      from: subDays(now, 30).getTime(),
      to: now.getTime(),
    },
    rankingProfile: RANKING_PROFILES.DEFAULT,
  }),
  'latest': (now) => ({
    freshnessWeight: FRESHNESS_WEIGHTS.LATEST,
    filteringWeight: FILTERING_WEIGHTS.LATEST,
    timeRange: {
      from: subDays(now, 30).getTime(),
      to: now.getTime(),
    },
    rankingProfile: RANKING_PROFILES.DEFAULT,
  }),
  'this week': (now) => ({
    freshnessWeight: FRESHNESS_WEIGHTS.THIS_WEEK,
    filteringWeight: FILTERING_WEIGHTS.THIS_WEEK,
    timeRange: {
      from: startOfWeek(now).getTime(),
      to: endOfDay(now).getTime(),
    },
    rankingProfile: RANKING_PROFILES.DEFAULT,
  }),
  
  'last week': (now) => ({
    freshnessWeight: FRESHNESS_WEIGHTS.LAST_WEEK,
    filteringWeight: FILTERING_WEIGHTS.LAST_WEEK,
    timeRange: {
      from: subDays(startOfWeek(now), 7).getTime(),
      to: endOfDay(subDays(startOfWeek(now), 1)).getTime(),
    },
    rankingProfile: RANKING_PROFILES.DEFAULT,
  }),
  
  'last 7 days': (now) => ({
    freshnessWeight: FRESHNESS_WEIGHTS.LAST_7_DAYS,
    filteringWeight: FILTERING_WEIGHTS.LAST_7_DAYS,
    timeRange: {
      from: subDays(now, 7).getTime(),
      to: now.getTime(),
    },
    rankingProfile: RANKING_PROFILES.DEFAULT,
  }),
  
  // Lower urgency keywords
  'this month': (now) => ({
    freshnessWeight: FRESHNESS_WEIGHTS.THIS_MONTH,
    filteringWeight: FILTERING_WEIGHTS.THIS_MONTH,
    timeRange: {
      from: startOfMonth(now).getTime(),
      to: endOfDay(now).getTime(),
    },
    rankingProfile: RANKING_PROFILES.DEFAULT,
  }),
  
  'last month': (now) => ({
    freshnessWeight: FRESHNESS_WEIGHTS.LAST_MONTH,
    filteringWeight: FILTERING_WEIGHTS.LAST_MONTH,
    timeRange: {
      from: startOfMonth(subDays(startOfMonth(now), 1)).getTime(),
      to: endOfDay(subDays(startOfMonth(now), 1)).getTime(),
    },
    rankingProfile: RANKING_PROFILES.DEFAULT,
  }),
  
  'last 30 days': (now) => ({
    freshnessWeight: FRESHNESS_WEIGHTS.LAST_30_DAYS,
    filteringWeight: FILTERING_WEIGHTS.LAST_30_DAYS,
    timeRange: {
      from: subDays(now, 30).getTime(),
      to: now.getTime(),
    },
    rankingProfile: RANKING_PROFILES.DEFAULT,
  }),
  
  
  
};

// ============== Main Parser Function ==============

/**
 * Parse a search query to extract time keywords and generate config
 * 
 * @param query - Raw user search query
 * @param referenceTime - Reference time for calculations (default: now)
 * @returns Parsed query with time configuration
 * 
 * @example
 * parseTimeKeywords("deployment issues from today")
 * // Returns:
 * // {
 * //   originalQuery: "deployment issues from today",
 * //   cleanedQuery: "deployment issues",
 * //   hasTimeKeyword: true,
 * //   config: {
 * //     keyword: "today",
 * //     freshnessWeight: 0.5,
 * //     timeRange: { from: <today_start_ms>, to: <today_end_ms> },
 * //     rankingProfile: "time_aware"
 * //   }
 * // }
 */
export function parseTimeKeywords(
  query: string,
  referenceTime: Date = new Date()
): ParsedTimeQuery {
  // Handle empty/null queries
  if (!query || query.trim().length === 0) {
    return {
      originalQuery: query || '',
      cleanedQuery: '',
      hasTimeKeyword: false,
      config: null,
    };
  }

  const lowerQuery = query.toLowerCase();
  
  // Sort keywords by length (longest first) to match "last 24 hours" before "last"
  const sortedKeywords = Object.keys(TIME_KEYWORD_DEFINITIONS)
    .sort((a, b) => b.length - a.length);
  
  // Find matching time keyword
  let matchedKeyword: string | null = null;
  
  for (const keyword of sortedKeywords) {
    // Create pattern for this specific keyword with optional prefixes
    const keywordPattern = new RegExp(
      `\\b(?:from|in|within|during|for|over)?\\s*${keyword.replace(/\s+/g, '\\s+')}\\b`,
      'i'
    );
    
    if (keywordPattern.test(lowerQuery)) {
      matchedKeyword = keyword;
      break;
    }
  }

  // No time keyword found
  if (!matchedKeyword) {
    return {
      originalQuery: query,
      cleanedQuery: query.trim(),
      hasTimeKeyword: false,
      config: null,
    };
  }

  // Generate config for matched keyword
  const configGenerator = TIME_KEYWORD_DEFINITIONS[matchedKeyword];
  const generatedConfig = configGenerator(referenceTime);
  
  // Clean query by removing time keyword and prefixes
  const cleanPattern = new RegExp(
    `\\b(?:from|in|within|during|for|over)?\\s*${matchedKeyword.replace(/\s+/g, '\\s+')}\\b`,
    'gi'
  );
  const cleanedQuery = query
    .replace(cleanPattern, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    originalQuery: query,
    cleanedQuery,
    hasTimeKeyword: true,
    config: {
      keyword: matchedKeyword,
      ...generatedConfig,
    },
  };
}

// ============== Utility Functions ==============

/**
 * Get default freshness weight (when no time keyword detected)
 */
export function getDefaultFreshnessWeight(): number {
  return FRESHNESS_WEIGHTS.DEFAULT;
}
export function getDefaultFilteringWeight(): number {
  return FILTERING_WEIGHTS.DEFAULT;
}
/**
 * Get default ranking profile
 */
export function getDefaultRankingProfile(): string {
  return RANKING_PROFILES.DEFAULT;
}

/**
 * Format time range for logging/debugging
 */
export function formatTimeRange(timeRange: TimeRange): string {
  const from = new Date(timeRange.from);
  const to = new Date(timeRange.to);
  return `${from.toISOString()} to ${to.toISOString()}`;
}

/**
 * Get all supported time keywords
 */
export function getSupportedTimeKeywords(): string[] {
  return Object.keys(TIME_KEYWORD_DEFINITIONS);
}
