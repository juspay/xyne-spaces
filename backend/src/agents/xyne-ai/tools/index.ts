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
  EntityType,
  MessageMappings,
  EnhancedCitationMappings,
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
  appendSessionMappings,  // Legacy - for backward compatibility
  appendEnhancedSessionMappings,  // New - for multi-entity citations
  getAndClearSessionMappings,
} from './helpers.js';

// ============================================================================
// Tool Imports
// ============================================================================

import { createFetchChannelMessagesTool, getFetchChannelMessagesTool } from './fetch_channel_messages.js';
import { createFetchThreadMessagesTool, getFetchThreadMessagesTool } from './fetch_thread_messages.js';
import { createSearchRelevantMessagesTool, getSearchRelevantMessagesTool } from './search_relevant_messages.js';
import { createSearchGmailTool, getSearchGmailTool } from './search_gmail.js';
import {
  createGenerateTeamIntelligenceReportTool,
  getGenerateTeamIntelligenceReportTool,
} from './generate_team_intelligence_report.js';
import { createSearchRelevantTicketsTool, getSearchRelevantTicketsTool } from './search_relevant_tickets.js';
import { createSearchMeetingInsightsTool, getSearchMeetingInsightsTool } from './search_meeting_insights.js';
import { createFieldValueDiscoveryTool } from './field_value_discovery.js';
import { createGeniusTool, getGeniusTool } from './genius.js';
import { createXyneRcaTool, getXyneRcaTool } from './xyne_rca.js';
import { createWebSearchTool, getWebSearchTool } from './web_search.js';
import { createResearchAgentTool, getResearchAgentTool } from './research_agent.js';
import { createCreateCanvasTool, getCreateCanvasTool } from './create_canvas.js';
import { createReadCanvasTool, getReadCanvasTool } from './read_canvas.js';
import { createEditCanvasTool, getEditCanvasTool } from './edit_canvas.js';
import { createFetchLinkContentTool, getFetchLinkContentTool } from './fetch_link_content.js';
import { createCreatePptTool, getCreatePptTool } from './create_ppt/index.js';

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

// Search Gmail
export { createSearchGmailTool, getSearchGmailTool };

// Generate Team Intelligence Report
export {
  createGenerateTeamIntelligenceReportTool,
  getGenerateTeamIntelligenceReportTool,
};

// Search Relevant Tickets
export { createSearchRelevantTicketsTool, getSearchRelevantTicketsTool };

// Search Meeting Insights
export { createSearchMeetingInsightsTool, getSearchMeetingInsightsTool };

// Field Value Discovery
export { createFieldValueDiscoveryTool };

// Genius
export { createGeniusTool, getGeniusTool };

// Xyne RCA
export { createXyneRcaTool, getXyneRcaTool };

// Web Search
export { createWebSearchTool, getWebSearchTool };

// Research Agent
export { createResearchAgentTool, getResearchAgentTool };

// Create Canvas
export { createCreateCanvasTool, getCreateCanvasTool };

// Read Canvas
export { createReadCanvasTool, getReadCanvasTool };

// Edit Canvas
export { createEditCanvasTool, getEditCanvasTool };

// Fetch Link Content
export { createFetchLinkContentTool, getFetchLinkContentTool };

// Create PPT
export { createCreatePptTool, getCreatePptTool };

// ============================================================================
// Get All Tools
// ============================================================================

/**
 * Options for configuring which tools to include
 */
export interface GetXyneAIToolsOptions {
  webSearchEnabled?: boolean;
  gmailSearchEnabled?: boolean;
  hasThreadContext?: boolean;
}

/**
 * Get all Xyne AI tools (with descriptions from Langfuse)
 * MUST call initializeTools() before using this function
 * 
 * @param options Configuration options
 * @param options.webSearchEnabled Whether to include the web_search tool
 * @param options.hasThreadContext Whether to include the fetch_thread_messages tool (when conversationId is present)
 */
export function getXyneAITools(options?: GetXyneAIToolsOptions): Tool<any, XyneAIAgentContext>[] {
  const {
    webSearchEnabled = false,
    gmailSearchEnabled = false,
    hasThreadContext = false,
  } = options || {};
  
  const tools: Tool<any, XyneAIAgentContext>[] = [
    createFetchChannelMessagesTool(),
    createSearchRelevantMessagesTool(),
    createGenerateTeamIntelligenceReportTool(),
    createSearchRelevantTicketsTool(),
    createSearchMeetingInsightsTool(),
    createFieldValueDiscoveryTool(),
    createGeniusTool(),
    createXyneRcaTool(),
    createResearchAgentTool(),
    createCreateCanvasTool(),
    createReadCanvasTool(),
    createEditCanvasTool(),
    createFetchLinkContentTool(),
    createCreatePptTool(),
  ];

  if (gmailSearchEnabled) {
    tools.push(createSearchGmailTool());
  }

  // Add web search tool if runtime flag is true
  if (webSearchEnabled) {
    tools.push(createWebSearchTool());
  }

  // Add fetch_thread_messages tool if in thread context (conversationId is present)
  if (hasThreadContext) {
    tools.push(createFetchThreadMessagesTool());
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
