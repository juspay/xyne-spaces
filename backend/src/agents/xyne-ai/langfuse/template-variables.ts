/**
 * Template Variables for Langfuse Prompts
 */

import type { UserInfo, ResearchContext } from '../tools/index.js';

export type SourceType = 'thread' | 'channel';

export interface AvailableResearchOptions {
  productNames: string[];
  repositoryNames: string[];
}

function getCurrentTimestamp(): string {
  const now = new Date();
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/**
 * Format user info as a string for Langfuse templates
 * This will be available as {{user_info}} in prompts
 */
function formatUserInfo(userInfo?: UserInfo): string {
  if (!userInfo) {
    return 'Unknown User';
  }

  const parts: string[] = [];
  
  if (userInfo.userName) {
    parts.push(`Name: ${userInfo.userName}`);
  }
  
  if (userInfo.userEmail) {
    parts.push(`Email: ${userInfo.userEmail}`);
  }
  
  return parts.length > 0 ? parts.join(', ') : userInfo.userEmail || 'Unknown User';
}

/**
 * Format channel names for display in prompt
 */
function formatChannelContext(channelNames?: string[]): string {
  if (!channelNames || channelNames.length === 0) {
    return 'No channels in context (empty)';
  }
  
  const label = channelNames.length === 1 ? 'Current channel' : 'Current channels';
  return `${label}: ${channelNames.map(n => `"${n}"`).join(', ')} (already validated)`;
}

/**
 * Format current research context (selected product/repository) for agent prompt
 * Includes both current selection AND all available options
 */
function formatFullResearchContext(
  researchContext?: ResearchContext,
  researchOptions?: AvailableResearchOptions
): string {
  const parts: string[] = [];
  
  // Current selection
  if (researchContext) {
    const typeLabel = researchContext.type === 'product' ? 'Product' : 'Repository';
    parts.push(`Current ${typeLabel}: "${researchContext.name}"`);
  } else {
    parts.push('No product/repository selected');
  }
  
  // Available options
  if (researchOptions) {
    if (researchOptions.productNames.length > 0) {
      parts.push(`Available Products: [${researchOptions.productNames.join(', ')}]`);
    }
    if (researchOptions.repositoryNames.length > 0) {
      parts.push(`Available Repositories: [${researchOptions.repositoryNames.join(', ')}]`);
    }
  }
  
  return parts.join('\n');
}

export function buildAgentTemplateVariables(
  _source: SourceType,
  currentTimestamp?: string,
  userInfo?: UserInfo,
  channelNames?: string[],
  webSearchEnabled?: boolean,
  researchContext?: ResearchContext,
  researchOptions?: AvailableResearchOptions
): Record<string, string> {
  const variables = {
    current_timestamp: currentTimestamp || getCurrentTimestamp(),
    user_info: formatUserInfo(userInfo),
    channel_context: formatChannelContext(channelNames),
    web_search_tool_definition: webSearchEnabled
      ? `6. <tool>web_search</tool>
**Usage:** For external facts, recent news, documentation, or real-time data not present in Xyne Spaces.
**Description:** Performs a web search and returns relevant page titles, URLs, and snippets.
**Important:** 
- You can make multiple web_search tool calls with different queries if needed.
- Before searching, re-write the query for more accurate results (do your own reasoning first).
- Web search is for information retrieval only - it will not do any logical processing.
- DO NOT search for confidential or restricted data.
**Examples:** "what is the weather in bangalore today?", "who is the founder of Juspay?", "what is price of gold in india today?"`
      : '',
    web_search_handling_instructions: webSearchEnabled
      ? `- **External Knowledge Protocol:** If a query refers to external events, documentation, or facts beyond workspace context (e.g., "What is the latest version of React?", "weather in bangalore", "founder of Juspay", "price of gold in india"), use <tool>web_search</tool>.
- **Web Search Best Practices:** Before calling web_search, re-write the query for better accuracy. You can make multiple web_search calls with different queries. Web search is for information retrieval only - do your reasoning yourself.
- **Prohibited Searches:** DO NOT search for confidential or restricted data.`
      : `- **External Knowledge Protocol:** If a query refers to external events, documentation, or facts beyond workspace context, inform the user: "Web search is currently disabled. Please enable it to get real-time data from the internet."
- **Prohibited Searches:** DO NOT search for confidential or restricted data.`,
    web_search_citation_instructions: webSearchEnabled
      ? `- **Web Search Citations:** When citing web search results in your keypoints, use the format [A1], [A2], [B1], [B2] etc. where the letter (A, B, C...) represents the tool call number and the number (1, 2, 3...) represents the result index.
- **Citation Mapping:** The web_search tool displays results as [1], [2], [3]... but when citing in your response, you must prefix with the tool call letter (A for first call, B for second, etc.). So if you want to cite result [3] from your first web_search call, use [A3].
- **Single URL Per Keypoint:** When citing web_search results, provide ONLY ONE URL per keypoint. Each keypoint should cite exactly ONE search result with its URL. The system will automatically attach the corresponding URL to your citation.`
      : '',
    research_context: formatFullResearchContext(researchContext, researchOptions),
  };
  
  return variables;
}

