/**
 * Xyne AI Agent Tools - Main Entry Point
 * 
 * This file re-exports all tools and types for external use.
 */

import { type Tool } from '@xynehq/jaf';

// ============================================================================
// Types
// ============================================================================

export type {
  StreamProvider,
  StreamEvent,
  StreamEventCallback,
  UserInfo,
  XyneAIAgentContext,
  ResearchContext,
  ToolMessage,
  ToolResult,
  ToolResultWithCapping,
  MessageMappings,
  ToolDescriptions,
  ResearchAgentResponse,
} from './types.js';

export {
  XYNE_SPACES_REPOSITORY_ID,
  REDIS_CITATION_PREFIX,
  REDIS_COUNTER_PREFIX,
  CITATION_TTL_SECONDS,
} from './types.js';

// ============================================================================
// Helpers
// ============================================================================

export {
  initializeTools,
  getDescription,
  toIST,
  getISTTimestampForGenius,
  stripHtml,
  getDefaultDateRange,
  formatMessages,
  buildMessageMappings,
  formatToolResultForContext,
  resolveUserName,
  resolveChannelNames,
  getNextPrefix,
  appendSessionMappings,
  getAndClearSessionMappings,
} from './helpers.js';

// ============================================================================
// Tool Imports
// ============================================================================

import { createFetchChannelMessagesTool, getFetchChannelMessagesTool } from './fetch_channel_messages.js';
import { createFetchThreadMessagesTool, getFetchThreadMessagesTool } from './fetch_thread_messages.js';
import { createSearchRelevantMessagesTool, getSearchRelevantMessagesTool } from './search_relevant_messages.js';
import { createSearchRelevantTicketsTool, getSearchRelevantTicketsTool } from './search_relevant_tickets.js';
import { createFieldValueDiscoveryTool } from './field_value_discovery.js';
import { createGeniusTool, getGeniusTool } from './genius.js';
import { createWebSearchTool, getWebSearchTool } from './web_search.js';
import { createResearchAgentTool, getResearchAgentTool } from './research_agent.js';

import type { XyneAIAgentContext } from './types.js';

// ============================================================================
// Tool Exports
// ============================================================================

// Fetch Channel Messages
export { createFetchChannelMessagesTool, getFetchChannelMessagesTool };

// Fetch Thread Messages
export { createFetchThreadMessagesTool, getFetchThreadMessagesTool };

// Search Relevant Messages
export { createSearchRelevantMessagesTool, getSearchRelevantMessagesTool };

// Search Relevant Tickets
export { createSearchRelevantTicketsTool, getSearchRelevantTicketsTool };

// Field Value Discovery
export { createFieldValueDiscoveryTool };

// Genius
export { createGeniusTool, getGeniusTool };

// Web Search
export { createWebSearchTool, getWebSearchTool };

// Research Agent
export { createResearchAgentTool, getResearchAgentTool };

// ============================================================================
// Get All Tools
// ============================================================================

/**
 * Get all Xyne AI tools (with descriptions from Langfuse)
 * MUST call initializeTools() before using this function
 */
export function getXyneAITools(webSearchEnabled?: boolean): Tool<any, XyneAIAgentContext>[] {
  const tools = [
    createFetchChannelMessagesTool(),
    // createFetchThreadMessagesTool(), // Commented out in original
    createSearchRelevantMessagesTool(),
    createSearchRelevantTicketsTool(),
    createFieldValueDiscoveryTool(),
    createGeniusTool(),
    createResearchAgentTool(),
  ];

  // Add web search tool if runtime flag is true
  if (webSearchEnabled) {
    tools.push(createWebSearchTool());
  }

  return tools;
}

/**
 * Get field_value_discovery tool
 * MUST call initializeTools() before using
 */
export function getFieldValueDiscoveryTool() {
  return createFieldValueDiscoveryTool();
}
