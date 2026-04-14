/**
 * Field Value Discovery (FVD) Tool
 * 
 * Unified tool for validating and discovering field values (channels and usernames)
 * before using them in search operations.
 */

import { z } from 'zod';
import { type Tool } from '@juspay-jaf/jaf';
import { db } from '../../../database/client.js';
import { logger } from '../../../utils/logger.js';
import { findBestMatches } from '../utils/sequenceMatcher.js';
import { discoverUserByName, type UserDiscoveryResult } from '../utils/userDiscovery.js';
import type { XyneAIAgentContext } from './types.js';
import { getDescription } from './helpers.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Dimension lookup result (generic for both channels and users)
 */
interface DimensionLookupResult {
  query: string;
  matches: Array<{
    id: string;
    name: string;
    score: number;
  }>;
  error?: string;
}

/**
 * FVD Response
 */
interface FetchValidDimensionsResponse {
  success: boolean;
  field: 'channel' | 'username';
  results: DimensionLookupResult[];
  error?: string;
}

// ============================================================================
// Constants
// ============================================================================

const MATCH_THRESHOLD = 0.9; // 90% similarity required

// ============================================================================
// Channel Validation Implementation
// ============================================================================

/**
 * Validate channel names using fuzzy matching
 */
async function validateChannels(
  channelQueries: string[],
  userId: string,
  maxResults: number
): Promise<FetchValidDimensionsResponse> {
  try {
    logger.info(`[FVD] Validating channels: queries=${JSON.stringify(channelQueries)}, userId=${userId}`);

    // Validate input
    if (!channelQueries || channelQueries.length === 0) {
      return {
        success: false,
        field: 'channel',
        results: [],
        error: 'No channel queries provided. Please provide at least one channel name to search.',
      };
    }

    if (channelQueries.length > 5) {
      return {
        success: false,
        field: 'channel',
        results: [],
        error: 'Too many channel queries. Maximum 5 channel names allowed per request.',
      };
    }

    if (maxResults > 50) {
      return {
        success: false,
        field: 'channel',
        results: [],
        error: 'max_results cannot be greater than 50.',
      };
    }

    // Get all channels the user has access to
    const userChannels = await db.channelParticipant.findMany({
      where: { userId },
      select: { channelId: true },
    });

    const channelIds = userChannels.map(c => c.channelId);

    if (channelIds.length === 0) {
      return {
        success: false,
        field: 'channel',
        results: [],
        error: 'You do not have access to any channels.',
      };
    }

    // Fetch channel details
    const channels = await db.channel.findMany({
      where: { id: { in: channelIds } },
      select: { id: true, name: true },
    });

    const channelNames = channels.map(c => c.name);

    // Process each query
    const results: DimensionLookupResult[] = [];

    for (const query of channelQueries) {
      const trimmedQuery = query.trim();
      
      if (!trimmedQuery) {
        results.push({
          query,
          matches: [],
          error: 'Empty query string',
        });
        continue;
      }

      // Find best matches using fuzzy matching
      const matches = findBestMatches(trimmedQuery, channelNames, 0.3, maxResults);

      // Map matches to channel details
      const channelMatches = matches.map(match => {
        const channel = channels.find(c => c.name === match.value);
        return {
          id: channel?.id || '',
          name: match.value,
          score: match.score,
        };
      }).filter(m => m.id);

      results.push({
        query: trimmedQuery,
        matches: channelMatches,
      });
    }

    logger.info(`[FVD] Channel validation complete: ${results.filter(r => r.matches.length > 0).length}/${channelQueries.length} found`);

    return {
      success: true,
      field: 'channel',
      results,
    };
  } catch (error) {
    logger.error('[FVD] Channel validation error:', error);
    return {
      success: false,
      field: 'channel',
      results: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Username Validation Implementation
// ============================================================================

/**
 * Validate usernames using fuzzy matching
 */
async function validateUsernames(
  usernameQueries: string[],
  channelIds: string[],
  maxResults: number
): Promise<FetchValidDimensionsResponse> {
  try {
    logger.info(`[FVD] Validating usernames: queries=${JSON.stringify(usernameQueries)}, channelIds=${JSON.stringify(channelIds)}`);

    // Validate input
    if (!usernameQueries || usernameQueries.length === 0) {
      return {
        success: false,
        field: 'username',
        results: [],
        error: 'No username queries provided. Please provide at least one username to search.',
      };
    }

    if (usernameQueries.length > 5) {
      return {
        success: false,
        field: 'username',
        results: [],
        error: 'Too many username queries. Maximum 5 usernames allowed per request.',
      };
    }

    if (channelIds.length === 0) {
      return {
        success: false,
        field: 'username',
        results: [],
        error: 'No channel context provided. Cannot validate usernames without channel context.',
      };
    }

    // Process each username query
    const results: DimensionLookupResult[] = [];

    for (const query of usernameQueries) {
      const trimmedQuery = query.trim();
      
      if (!trimmedQuery) {
        results.push({
          query,
          matches: [],
          error: 'Empty query string',
        });
        continue;
      }

      // Search across ALL channels for user discovery
      const discoveryResult: UserDiscoveryResult = await discoverUserByName(trimmedQuery, channelIds, 0.6);

      if (!discoveryResult.success) {
        results.push({
          query: trimmedQuery,
          matches: [],
          error: discoveryResult.error,
        });
        continue;
      }

      if (discoveryResult.needsClarification) {
        // Multiple matches found - return all for clarification
        const userMatches = (discoveryResult.users || []).slice(0, maxResults).map(user => ({
          id: user.id,
          name: user.name || user.email || 'Unknown',
          score: user.matchScore,
        }));

        results.push({
          query: trimmedQuery,
          matches: userMatches,
        });
        continue;
      }

      // Single match found
      if (discoveryResult.users && discoveryResult.users.length > 0) {
        const user = discoveryResult.users[0];
        results.push({
          query: trimmedQuery,
          matches: [{
            id: user.id,
            name: user.name || user.email || 'Unknown',
            score: user.matchScore,
          }],
        });
      } else {
        results.push({
          query: trimmedQuery,
          matches: [],
          error: 'No users found',
        });
      }
    }

    logger.info(`[FVD] Username validation complete: ${results.filter(r => r.matches.length > 0).length}/${usernameQueries.length} found`);

    return {
      success: true,
      field: 'username',
      results,
    };
  } catch (error) {
    logger.error('[FVD] Username validation error:', error);
    return {
      success: false,
      field: 'username',
      results: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Format FVD Result
// ============================================================================

/**
 * Format FVD result for LLM context
 */
function formatFVDResult(response: FetchValidDimensionsResponse): string {
  if (!response.success) {
    return `Error: ${response.error}`;
  }

  if (response.results.length === 0) {
    return `No ${response.field} queries were processed.`;
  }

  const foundItems: string[] = [];
  const notFoundItems: string[] = [];

  for (const result of response.results) {
    if (result.error || result.matches.length === 0) {
      notFoundItems.push(result.query);
      continue;
    }

    // Check the top match
    const topMatch = result.matches[0];
    
    if (topMatch.score < MATCH_THRESHOLD) {
      notFoundItems.push(result.query);
      continue;
    }
    
    foundItems.push(topMatch.name);
  }

  const formatted = response.results.map(result => {
    if (result.error) {
      return `Query "${result.query}": Error - ${result.error}`;
    }

    if (result.matches.length === 0) {
      return `Query "${result.query}": NOT FOUND - This ${response.field} does not exist or you don't have access.`;
    }

    // Simplified output - just show names
    const matchList = result.matches
      .map((m, idx) => `  ${idx + 1}. "${m.name}"`)
      .join('\n');

    return `Query "${result.query}":\n${matchList}`;
  }).join('\n\n');

  // Build validation summary
  let validationSummary = '';
  
  if (notFoundItems.length > 0) {
    validationSummary += `\n\nNOT FOUND: ${notFoundItems.map(c => `"${c}"`).join(', ')}`;
    validationSummary += `\n   → These ${response.field} names don't exist or you don't have access. Ask user to verify the exact name.`;
  }
  
  if (foundItems.length > 0) {
    validationSummary += `\n\nAVAILABLE FOR USE: ${foundItems.map(c => `"${c}"`).join(', ')}`;
    if (response.field === 'channel') {
      validationSummary += `\n   → You can search these channels. Use the channel NAMES (not IDs) in search_relevant_content.`;
    } else {
      validationSummary += `\n   → You can filter by these usernames in search_relevant_content.`;
    }
  }

  // Only block if NO items were found at all
  if (notFoundItems.length > 0 && foundItems.length === 0) {
    validationSummary += `\n\nINSTRUCTION: Cannot proceed - no valid ${response.field}s found. Ask user to verify names.`;
  } else if (notFoundItems.length > 0 && foundItems.length > 0) {
    validationSummary += `\n\nINSTRUCTION: Some ${response.field}s not found. Proceed with available ones and inform user about missing ones.`;
  }

  return `${response.field.charAt(0).toUpperCase() + response.field.slice(1)} Validation Results:\n\n${formatted}${validationSummary}`;
}

interface CombinedFVDResult {
  channelResult?: FetchValidDimensionsResponse;
  usernameResult?: FetchValidDimensionsResponse;
}

/**
 * Format combined FVD result for LLM context
 */
function formatCombinedFVDResult(combined: CombinedFVDResult): string {
  const parts: string[] = [];
  
  if (combined.channelResult) {
    parts.push(formatFVDResult(combined.channelResult));
  }
  
  if (combined.usernameResult) {
    parts.push(formatFVDResult(combined.usernameResult));
  }
  
  return parts.join('\n\n---\n\n');
}

/**
 * Create field_value_discovery tool - Unified FVD for channels and usernames
 * Can validate both in a single call!
 */
export function createFieldValueDiscoveryTool(): Tool<
  { channels?: string[]; usernames?: string[]; max_results?: number },
  XyneAIAgentContext
> {
  return {
    schema: {
      name: 'field_value_discovery',
      description: getDescription('field_value_discovery'),
      parameters: z.object({
        channels: z.array(z.string()).max(5).optional().describe('List of channel names to validate (max 5)'),
        usernames: z.array(z.string()).max(5).optional().describe('List of usernames to validate (max 5)'),
        max_results: z.number().optional().default(5).describe('Maximum matches per query (default: 5, max: 50)'),
      }),
    },
    execute: async (args, context) => {
      const { channels, usernames, max_results = 5 } = args;
      logger.info(`[FVD] Tool called: channels=${JSON.stringify(channels)}, usernames=${JSON.stringify(usernames)}, max_results=${max_results}`);
      
      // Validate that at least one field is provided
      if ((!channels || channels.length === 0) && (!usernames || usernames.length === 0)) {
        return 'Error: Please provide at least one channel name or username to validate.';
      }
      
      const combined: CombinedFVDResult = {};
      
      // Use pre-computed context channel map
      const contextChannelMap = context.contextChannelMap || new Map();
      
      // Validate channels if provided
      if (channels && channels.length > 0) {
        // Filter out channels that are already in context
        const alreadyValidated: string[] = [];
        const needsValidation: string[] = [];
        
        for (const channelName of channels) {
          const normalizedName = channelName.trim().toLowerCase();
          if (contextChannelMap.has(normalizedName)) {
            alreadyValidated.push(channelName);
            logger.info(`[FVD] Channel "${channelName}" already in context - skipping validation`);
          } else {
            needsValidation.push(channelName);
          }
        }
        
        // If all channels are already in context, return early
        if (alreadyValidated.length > 0 && needsValidation.length === 0) {
          const alreadyValidatedResult: FetchValidDimensionsResponse = {
            success: true,
            field: 'channel',
            results: alreadyValidated.map(name => ({
              query: name,
              matches: [{
                id: contextChannelMap.get(name.toLowerCase()) || '',
                name: name,
                score: 1.0,
              }],
            })),
          };
          combined.channelResult = alreadyValidatedResult;
          logger.info(`[FVD] All ${alreadyValidated.length} channels already in context - no validation needed`);
        } else if (needsValidation.length > 0) {
          // Only validate channels not in context
          const channelResult = await validateChannels(needsValidation, context.userId, max_results);
          
          // Add already validated channels to the result
          if (alreadyValidated.length > 0) {
            for (const name of alreadyValidated) {
              channelResult.results.unshift({
                query: name,
                matches: [{
                  id: contextChannelMap.get(name.toLowerCase()) || '',
                  name: name,
                  score: 1.0,
                }],
              });
            }
          }
          
          combined.channelResult = channelResult;
        }
        
        // Store channel name→ID mappings in request context
        if (combined.channelResult?.success && context.requestMappings) {
          for (const queryResult of combined.channelResult.results) {
            if (queryResult.matches && queryResult.matches.length > 0) {
              for (const match of queryResult.matches) {
                const normalizedName = match.name.trim().toLowerCase();
                context.requestMappings.channelNameToId.set(normalizedName, match.id);
              }
            }
          }
        }
      }
      
      // Validate usernames if provided
      if (usernames && usernames.length > 0) {
        // Use validated channel IDs if channels were provided, otherwise use context channels
        let channelIdsForUserValidation: string[] = context.channelIds;
        
        if (combined.channelResult?.success) {
          // Extract channel IDs from validated channels
          const validatedChannelIds: string[] = [];
          for (const queryResult of combined.channelResult.results) {
            if (queryResult.matches && queryResult.matches.length > 0) {
              // Use the first match (best match) for each query
              validatedChannelIds.push(queryResult.matches[0].id);
            }
          }
          
          if (validatedChannelIds.length > 0) {
            channelIdsForUserValidation = validatedChannelIds;
          }
        }
        
        const usernameResult = await validateUsernames(usernames, channelIdsForUserValidation, max_results);
        combined.usernameResult = usernameResult;
        
        // Store user name→ID mappings in request context
        if (usernameResult.success && context.requestMappings) {
          for (const queryResult of usernameResult.results) {
            if (queryResult.matches && queryResult.matches.length > 0) {
              for (const match of queryResult.matches) {
                const normalizedName = match.name.trim().toLowerCase();
                context.requestMappings.userNameToId.set(normalizedName, match.id);
              }
            }
          }
        }
      }
      
      return formatCombinedFVDResult(combined);
    },
  };
}