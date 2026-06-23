/**
 * Xyne AI Agent Tools - Main Entry Point
 * 
 * This file re-exports all tools and types for external use.
 */

import { type Tool } from '@juspay-jaf/jaf';
import { config } from '../../../config/env.js';

// ============================================================================
// Types
// ============================================================================

export type {
  StreamProvider,
  StreamEventCallback,
  UserInfo,
  XyneAIAgentContext,
  ResearchContext,
  AgentRequestContext,
  ToolMessage,
  ToolResult,
  MessageMappings,
  EnhancedCitationMappings,
  ToolDescriptions,
  ResearchAgentResponse,
} from './types.js';

export {
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
import { createSearchRelevantContentTool, getSearchRelevantContentTool } from './search_relevant_content.js';
import { createSearchMeetingInsightsTool, getSearchMeetingInsightsTool } from './search_meeting_insights.js';
import { createFieldValueDiscoveryTool } from './field_value_discovery.js';
import { createGeniusTool, getGeniusTool } from './genius.js';
import { createXyneRcaTool, getXyneRcaTool } from './xyne_rca.js';
import { createWebSearchTool, getWebSearchTool } from './web_search.js';
import { createDeepResearchTool } from './deep_research.js';
import { createResearchAgentTool, getResearchAgentTool } from './research_agent.js';
import { createCreateCanvasTool, getCreateCanvasTool } from './create_canvas.js';
import { createReadCanvasTool, getReadCanvasTool } from './read_canvas.js';
import { createEditCanvasTool, getEditCanvasTool } from './edit_canvas.js';
import { createFetchLinkContentTool, getFetchLinkContentTool } from './fetch_link_content.js';
import { createCreatePptTool, getCreatePptTool } from './create_ppt/index.js';
import { createGenerateImageTool, getGenerateImageTool } from './generate_image/index.js';
import { createFetchSkillInstructionsTool, getFetchSkillInstructionsTool } from './skills.js';
import { createManageUserSkillTool, getManageUserSkillTool } from './manage_user_skill.js';
import { createGetMemoriesTool, getGetMemoriesTool } from './get_memories.js';
import { createUpdateMemoryTool, getUpdateMemoryTool } from './update_memory.js';
import { createUserActivityTool, getUserActivityTool } from './user_activity.js';
import { createListUserChannelsTool } from './list_user_channels.js';
import { createSearchFilesTool, getSearchFilesTool } from './search_files.js';
import { createGetPageContentTool, getGetPageContentTool } from './get_page_content.js';
import { createGetDocumentOutlineTool, getGetDocumentOutlineTool } from './get_document_outline.js';

import type { XyneAIAgentContext } from './types.js';

// ============================================================================
// Tool Exports
// ============================================================================

// Fetch Channel Messages
export { createFetchChannelMessagesTool, getFetchChannelMessagesTool };

// Fetch Thread Messages
export { createFetchThreadMessagesTool, getFetchThreadMessagesTool };

// Search Relevant Content (unified: messages, tickets, canvas, calls, recordings)
export { createSearchRelevantContentTool, getSearchRelevantContentTool };

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

// Deep Research
export { createDeepResearchTool };

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

// Generate Image
export { createGenerateImageTool, getGenerateImageTool };

// Fetch Skill Instructions
export { createFetchSkillInstructionsTool, getFetchSkillInstructionsTool };

// Manage User Skills
export { createManageUserSkillTool, getManageUserSkillTool };

// Get Memories
export { createGetMemoriesTool, getGetMemoriesTool };

// Update Memory
export { createUpdateMemoryTool, getUpdateMemoryTool };

// User Activity
export { createUserActivityTool, getUserActivityTool };

// List User Channels
export { createListUserChannelsTool };

// Search Files
export { createSearchFilesTool, getSearchFilesTool };

// Get Page Content
export { createGetPageContentTool, getGetPageContentTool };

// Get Document Outline
export { createGetDocumentOutlineTool, getGetDocumentOutlineTool };

// ============================================================================
// Get All Tools
// ============================================================================

/**
 * Options for configuring which tools to include
 */
export interface GetXyneAIToolsOptions {
  webSearchEnabled?: boolean;
  deepResearchEnabled?: boolean;
  hasThreadContext?: boolean;
  memoryEnabled?: boolean;
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
  const { webSearchEnabled = false, deepResearchEnabled = false, hasThreadContext = false, memoryEnabled = true } = options || {};

  const tools: Tool<any, XyneAIAgentContext>[] = [
    createFetchChannelMessagesTool(),
    createSearchRelevantContentTool(),
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
    createGenerateImageTool(),
    createFetchSkillInstructionsTool(),
    createManageUserSkillTool(),
    createUserActivityTool(),
    createListUserChannelsTool(),
    createSearchFilesTool(),
    createGetPageContentTool(),
    createGetDocumentOutlineTool(),
  ];

  // These 4 tools are purely dependent on XYNE_AI_EXTENDED_URL
  if (config.xyneAiExtended.url) {
    if (webSearchEnabled) tools.push(createWebSearchTool());
    if (deepResearchEnabled) tools.push(createDeepResearchTool());
    if (memoryEnabled) {
      tools.push(createGetMemoriesTool());
      tools.push(createUpdateMemoryTool());
    }
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
