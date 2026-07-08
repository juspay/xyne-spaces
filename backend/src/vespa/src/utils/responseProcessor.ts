import { type VespaSearchResponse } from '../types';
import { highlightText, calculatePrefixBoost } from './highlight';
import type { ILogger } from '../services/searchService';

interface ProcessResult {
  nodes: any[];
  processedCount: number;
  filteredCount: number;
}

const stripHighlightTags = (text: string): string => {
  if (!text) return text;
  return text.replace(/<\/?hi>/g, '');
};

/**
 * Generic recursive node processor
 * @param nodes - Array of nodes to process
 * @param processor - Function to process each hit node
   * @returns Processed nodes with counts
   */
  const processNodesRecursively = (
    nodes: any[],
    processor: (node: any) => { keep: boolean; node?: any }
  ): ProcessResult => {
    let processedCount = 0;
    let filteredCount = 0;

    const processNodes = (nodes: any[]): any[] => {
      const processed: any[] = [];

      for (const node of nodes) {
        // Handle grouped children recursively
        if (node.children && Array.isArray(node.children)) {
          const processedChildren = processNodes(node.children);
          if (processedChildren.length > 0) {
            processed.push({ ...node, children: processedChildren });
          }
          continue;
        }

        // Process hit nodes
        if (node.fields) {
          processedCount++;
          const result = processor(node);

          if (result.keep && result.node) {
            processed.push(result.node);
          } else if (!result.keep) {
            filteredCount++;
          }
        }
      }

      return processed;
    };

    return {
      nodes: processNodes(nodes),
      processedCount,
      filteredCount,
    };
  }

  /**
   * Build updated response with optional totalCount update
   */
  const buildResponse = (
    response: VespaSearchResponse,
    processedChildren: any[],
    updatedTotalCount: number,
    shouldUpdateTotalCount: boolean
  ): VespaSearchResponse => {
    const updatedRoot: any = {
      ...response.root,
      children: processedChildren,
    };

    // Update totalCount for flat responses
    const wasGrouped = response.root.children?.some((child: any) =>
      child.id && (child.id.startsWith('group:') || child.id.startsWith('grouplist:'))
    );

    if (!wasGrouped && response.root.fields?.totalCount !== undefined) {
      updatedRoot.fields = {
        ...response.root.fields,
        totalCount: shouldUpdateTotalCount? updatedTotalCount : response.root.fields.totalCount,
      };
    }

    return { ...response, root: updatedRoot };
  }
  const highlightField = (
  value: string | undefined | null,
  query: string,
  mentionNames?: string[]
  ): { highlighted: string; wasHighlighted: boolean } => {
    if (typeof value !== 'string' || !value) {
      return { highlighted: value || '', wasHighlighted: false };
    }
    const highlighted = highlightText(value, query, mentionNames);
    return { highlighted, wasHighlighted: highlighted.includes('<hi>') };
};
  /**
   * Filter by native rank threshold
   */
 export const filterByNativeRank = (
    response: VespaSearchResponse,
    threshold: number,
    logger: ILogger
  ): VespaSearchResponse => {
    if (!response.root?.children || response.root.children.length === 0 || threshold <= 0) {
      return response;
    }

    const result = processNodesRecursively(response.root.children, (node) => {
      const matchFeatures = node.fields?.matchfeatures;
      const nativeRank = matchFeatures?.combined_nativeRank ?? node.fields?.rankfeatures?.nativeRank;

      if (typeof nativeRank === 'number' && nativeRank >= threshold) {
        return { keep: true, node };
      }
      return { keep: false };
    });

    if (result.filteredCount > 0) {
      logger.info(`Filtered ${result.filteredCount} results below nativerank threshold ${threshold}`);
    }
  return buildResponse(response , result.nodes , result.nodes.length , result.filteredCount>0);
}

  /**
   * Apply highlighting to search results
   */
  export const applyHighlighting = (
  response: VespaSearchResponse,
  query: string,
  mentionNames: string[],
  limit: number,
  logger: ILogger
): VespaSearchResponse => {
  if (!query?.trim() || !response.root?.children || response.root.children.length === 0) {
    return response;
  }

  const result = processNodesRecursively(response.root.children, (node) => {
    const newFields = { ...node.fields };
    let wasHighlighted = false;

      const value = highlightField(newFields.text, query, mentionNames);
      newFields.text = value.highlighted;
      wasHighlighted = wasHighlighted || value.wasHighlighted;

      const ticket_title = highlightField(newFields.title, query);
      newFields.title = ticket_title.highlighted;
      wasHighlighted = wasHighlighted || ticket_title.wasHighlighted;

      const description = highlightField(newFields.description, query);
      newFields.description = description.highlighted;
      wasHighlighted = wasHighlighted || description.wasHighlighted;

      const initialMessage = highlightField(newFields.initialMessage, query);
      newFields.initialMessage = initialMessage.highlighted;
      wasHighlighted = wasHighlighted || initialMessage.wasHighlighted;

      // Mail schema fields: subject (string) + chunks (array<string>)
      const subject = highlightField(newFields.subject, query);
      newFields.subject = subject.highlighted;
      wasHighlighted = wasHighlighted || subject.wasHighlighted;

      if (Array.isArray(newFields.chunks)) {
        const highlightedChunks = newFields.chunks.map((c: unknown) => {
          const r = highlightField(typeof c === 'string' ? c : '', query);
          wasHighlighted = wasHighlighted || r.wasHighlighted;
          return r.highlighted;
        });
        newFields.chunks = highlightedChunks;
      }

    // // Filter out results with no highlighting
    if (!wasHighlighted) {
      return { keep: false };
    }

    return { keep: true, node: { ...node, fields: newFields } };
  });

  if (result.processedCount > 0) {
    logger.info(
      `Highlighting: Processed ${result.processedCount}, filtered ${result.filteredCount}, kept ${result.processedCount - result.filteredCount}`
    );
  }

  return buildResponse(response, result.nodes , limit , result.processedCount === result.filteredCount);
}

  /**
   * Apply prefix boost to search results
   */
  export const applyPrefixBoost = (
    response: VespaSearchResponse,
    query: string,
    boostWeight: number,
    limit: number,
    logger: ILogger
  ): VespaSearchResponse => {
    if (!query?.trim() || !response.root?.children || response.root.children.length === 0) {
      return response;
    }

    const result = processNodesRecursively(response.root.children, (node) => {
      const originalScore = node.relevance || 0;
      const textValue = node.fields.text;
      const ticket_title = node.fields.title;
      const description = node.fields.description;
      const initialMessage = node.fields.initialMessage;
      let maxPrefixBoost = 0;
      if (typeof textValue === 'string' && textValue) {
        const cleanText = stripHighlightTags(textValue);
        maxPrefixBoost = calculatePrefixBoost(cleanText, query);
      }
      if (typeof ticket_title === 'string' && ticket_title) {
        const cleanTitle = stripHighlightTags(ticket_title);
        maxPrefixBoost = calculatePrefixBoost(cleanTitle, query);
      }
      if (typeof description === 'string' && description) {
        const cleanDescription = stripHighlightTags(description);
        maxPrefixBoost = calculatePrefixBoost(cleanDescription, query);
      }
      if (typeof initialMessage === 'string' && initialMessage) {
        const cleanInitialMessage = stripHighlightTags(initialMessage);
        maxPrefixBoost = calculatePrefixBoost(cleanInitialMessage, query);
      }

      // Filter out results with no prefix match
      // if (maxPrefixBoost === 0) {
      //   return { keep: false };
      // }

      // Calculate boosted score
      const boostedScore = originalScore + (maxPrefixBoost * boostWeight * originalScore);

      return {
        keep: true,
        node: {
          ...node,
          relevance: boostedScore,
          fields: {
            ...node.fields,
            _prefixBoost: maxPrefixBoost,
            _originalScore: originalScore,
          },
        },
      };
    });

    // Sort by relevance after processing
    const sortedNodes = result.nodes.sort((a: any, b: any) => (b.relevance || 0) - (a.relevance || 0));

    if (result.filteredCount > 0) {
      logger.info(
        `PrefixBoost: Processed ${result.processedCount}, filtered ${result.filteredCount}, kept ${result.processedCount - result.filteredCount}`
      );
    }

    return buildResponse(response, sortedNodes , limit , result.processedCount === result.filteredCount);
  }
