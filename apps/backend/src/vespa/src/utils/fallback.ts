import type { VespaSearchResponse } from '../types';
import { applyHighlighting, applyPrefixBoost } from './responseProcessor';
import type { ILogger } from '../services/searchService';

interface FuzzyFallbackOptions {
  searchQuery: string;
  limit: number;
  prefixBoostWeight: number;
  mentionNames?: string[];
}

interface FuzzyFallbackResult {
  mergedResponse: VespaSearchResponse;
  exactCount: number;
  fuzzyCount: number;
}

/** Synthetic nodes Vespa's grouping inserts, as opposed to real document hits. */
const isGroupingNode = (node: any): boolean =>
  typeof node?.id === 'string' &&
  (node.id.startsWith('group:') || node.id.startsWith('grouplist:') || node.id.startsWith('hitlist:'));

/**
 * Flatten a response to its document hits.
 *
 * With `| all(group(...))` the documents sit several levels below root.children, whose entries
 * are grouping nodes. Reading root.children directly saw ONE node per response, and its id
 * ("group:root:0") is identical in the exact and fuzzy responses -- so the dedupe below
 * discarded the entire fuzzy result set on every grouped search.
 */
const collectHits = (node: any): any[] => {
  if (!node) return [];
  const children = node.children as any[] | undefined;
  if (children?.length) return children.flatMap(collectHits);
  return isGroupingNode(node) ? [] : [node];
};

/** Stable identity for a hit, preferring the document id over Vespa's internal id. */
const hitId = (hit: any): string =>
  hit?.fields?.docId || hit?.fields?.messageId || hit?.id || '';

/**
 * Get unique document IDs from a Vespa response
 */
const getDocIds = (response: VespaSearchResponse): Set<string> => {
  return new Set(collectHits(response.root).map(hitId).filter(Boolean));
};

/**
 * Filter out results that are already in the exact results
 */
const getUniqueResults = (
  fuzzyChildren: any[],
  exactDocIds: Set<string>
): any[] => {
  return fuzzyChildren.filter((child: any) => {
    const docId = hitId(child);
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
  fuzzyResponse?: VespaSearchResponse,
): VespaSearchResponse => {
  if (fuzzyResults.length === 0) {
    return exactResponse;
  }

  // Exact found nothing but still returned a grouped shell (`group:root:0` with no documents).
  // Appending hits at root there is invisible: the reader in vespaSearch/index.ts sees a
  // grouping node, switches to group parsing, and never looks at root-level hits. Return the
  // fuzzy response's own grouped tree instead, with the kept hits marked in place.
  const exactHasGrouping = (exactResponse.root?.children ?? []).some(isGroupingNode);
  if (exactHasGrouping && collectHits(exactResponse.root).length === 0 && fuzzyResponse?.root) {
    const keptIds = new Set(fuzzyResults.map(hitId).filter(Boolean));
    const markKept = (node: any): any => {
      if (node?.children?.length) return { ...node, children: node.children.map(markKept) };
      if (isGroupingNode(node) || !keptIds.has(hitId(node))) return node;
      return { ...node, fields: { ...node.fields, _isFuzzyMatch: true } };
    };
    return { ...exactResponse, root: markKept(fuzzyResponse.root) };
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
  const { searchQuery, limit, prefixBoostWeight, mentionNames = [] } = options;
  
  const exactCount = exactResponse.root?.children?.length || 0;

  // Get exact result IDs
  const exactDocIds = getDocIds(exactResponse);

  // Execute fuzzy search
  let fuzzyResponse = await executeFuzzySearch();

  // Apply highlighting
  if (searchQuery?.trim()) {
    fuzzyResponse = applyHighlighting(fuzzyResponse, searchQuery, mentionNames, limit , logger);
  }

  // Apply prefix boost
  if (searchQuery?.trim() && prefixBoostWeight > 0) {
    fuzzyResponse = applyPrefixBoost(fuzzyResponse, searchQuery, prefixBoostWeight, limit , logger);
  }

  // Get unique fuzzy results
  // Document hits, not the grouping nodes sitting at root.children.
  const fuzzyChildren = collectHits(fuzzyResponse.root);
  const uniqueFuzzyResults = getUniqueResults(fuzzyChildren, exactDocIds);
  const markedFuzzyResults = markAsFuzzyResults(uniqueFuzzyResults);

  logger.info(
    `Fuzzy search: ${fuzzyChildren.length} total, ${uniqueFuzzyResults.length} unique, adding ${markedFuzzyResults.length}`
  );

  // Merge results
  const mergedResponse = mergeResults(exactResponse, markedFuzzyResults, fuzzyResponse);

  return {
    mergedResponse,
    exactCount,
    fuzzyCount: markedFuzzyResults.length,
  };
};