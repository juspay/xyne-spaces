import type { VespaSearchResponse } from '../types';
import { applyHighlighting, applyPrefixBoost } from './responseProcessor';
import type { ILogger } from '../services/searchService';

interface FuzzyFallbackOptions {
  searchQuery: string;
  limit: number;
  prefixBoostWeight: number;
}

interface FuzzyFallbackResult {
  mergedResponse: VespaSearchResponse;
  exactCount: number;
  fuzzyCount: number;
}

/**
 * Get unique document IDs from a Vespa response
 */
const getDocIds = (response: VespaSearchResponse): Set<string> => {
  return new Set(
    response.root?.children?.map((child: any) =>
      child.fields?.docId || child.fields?.messageId || child.id
    ).filter(Boolean) || []
  );
};

/**
 * Filter out results that are already in the exact results
 */
const getUniqueResults = (
  fuzzyChildren: any[],
  exactDocIds: Set<string>
): any[] => {
  return fuzzyChildren.filter((child: any) => {
    const docId = child.fields?.docId || child.fields?.messageId || child.id;
    return docId && !exactDocIds.has(docId);
  });
};

/**
 * Mark results as fuzzy matches
 */
const markAsFuzzyResults = (results: any[]): any[] => {
  return results.map((child: any) => ({
    ...child,
    fields: {
      ...child.fields,
      _isFuzzyMatch: true,
    },
  }));
};

/**
 * Merge exact and fuzzy results into a single response
 */
const mergeResults = (
  exactResponse: VespaSearchResponse,
  fuzzyResults: any[],
): VespaSearchResponse => {
  if (fuzzyResults.length === 0) {
    return exactResponse;
  }
  const updatedRoot: any = {
      ...exactResponse.root,
      children: [
        ...(exactResponse.root?.children || []),
        ...fuzzyResults,
      ],
    };
    const wasGrouped = exactResponse.root.children?.some((child: any) =>
      child.id && (child.id.startsWith('group:') || child.id.startsWith('grouplist:'))
    );
    if (!wasGrouped && exactResponse.root.fields?.totalCount !== undefined) {
      updatedRoot.fields = {
        ...exactResponse.root.fields,
        totalCount: (exactResponse.root.fields.totalCount || 0) + fuzzyResults.length,
      };
    }
      return { ...exactResponse, root: updatedRoot };
  };

/**
 * Execute fuzzy fallback search and merge with exact results
 * NOTE: Caller is responsible for checking if fallback is needed
 * 
 * @param exactResponse - Response from exact search
 * @param executeFuzzySearch - Function to execute fuzzy search
 * @param responseProcessor - Response processor for highlighting/prefix boost
 * @param options - Search options
 * @param logger - Logger instance
 * @returns Merged response with exact and unique fuzzy results
 */
export const executeFuzzyFallback = async (
  exactResponse: VespaSearchResponse,
  executeFuzzySearch: () => Promise<VespaSearchResponse>,
  options: FuzzyFallbackOptions,
  logger: ILogger
): Promise<FuzzyFallbackResult> => {
  const { searchQuery, limit, prefixBoostWeight } = options;
  
  const exactCount = exactResponse.root?.children?.length || 0;

  // Get exact result IDs
  const exactDocIds = getDocIds(exactResponse);

  // Execute fuzzy search
  let fuzzyResponse = await executeFuzzySearch();

  // Apply highlighting
  if (searchQuery?.trim()) {
    fuzzyResponse = applyHighlighting(fuzzyResponse, searchQuery, limit , logger);
  }

  // Apply prefix boost
  if (searchQuery?.trim() && prefixBoostWeight > 0) {
    fuzzyResponse = applyPrefixBoost(fuzzyResponse, searchQuery, prefixBoostWeight, limit , logger);
  }

  // Get unique fuzzy results
  const fuzzyChildren = fuzzyResponse.root?.children || [];
  const uniqueFuzzyResults = getUniqueResults(fuzzyChildren, exactDocIds);
  const markedFuzzyResults = markAsFuzzyResults(uniqueFuzzyResults);

  logger.info(
    `Fuzzy search: ${fuzzyChildren.length} total, ${uniqueFuzzyResults.length} unique, adding ${markedFuzzyResults.length}`
  );

  // Merge results
  const mergedResponse = mergeResults(exactResponse, markedFuzzyResults);

  return {
    mergedResponse,
    exactCount,
    fuzzyCount: markedFuzzyResults.length,
  };
};