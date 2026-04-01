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
  // Convert to IST (UTC+5:30) by adding 330 minutes
  const istTime = new Date(now.getTime() + (330 * 60 * 1000));
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${istTime.getUTCFullYear()}-${pad(istTime.getUTCMonth() + 1)}-${pad(istTime.getUTCDate())} ${pad(istTime.getUTCHours())}:${pad(istTime.getUTCMinutes())}:${pad(istTime.getUTCSeconds())}`;
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

/**
 * Format custom instructions for agent prompt
 */
function formatCustomInstructions(customInstruction?: string): string {
  if (!customInstruction) {
    return '';
  }
  
  return `The following instructions OVERRIDE tone and stylistic defaults
but MUST NOT override:
- Tool selection logic
- JSON schema
- Safety policies

${customInstruction}`;
}

/**
 * Format thread context indicator when conversationId is present
 * Kept concise - just indicates thread mode is active
 */
function formatThreadContext(hasThreadContext: boolean): string {
  if (!hasThreadContext) {
    return 'NO THREAD CONTEXT PROVIDED - If the user asks about a thread, please politely ask the user to add the thread to Ask AI context';
  }
  
  return `**THREAD MODE ACTIVE** - Use <tool>fetch_thread_messages</tool> for "summarize this thread" or other thread-related queries.`;
}

/**
 * Format fetch_thread_messages handling instructions
 */
function formatFetchThreadMessagesInstructions(hasThreadContext: boolean): string {
  if (!hasThreadContext) {
    return '';
  }
  
  return `
## 4. THREAD SUMMARIZATION RULES (When in Thread Context)
- **Trigger Keywords:** summarize this thread, catch up on this conversation, what was discussed here, tldr of this thread.
- **Tool:** Use <tool>fetch_thread_messages</tool>.
- **No Parameters Needed:** The tool automatically uses the current thread context.
- **Scope:** Summarizes all content in the current thread including messages, attachments, calls, and tickets.
- **Style:** Start with "This thread..." or "In this conversation...". Be terse. Attribute actions to specific users.
- **Citations:** Use the citation references returned by the tool (e.g., [A1], [A2]) to cite specific messages.`;
}

/**
 * Format few-shot example for thread summarization
 */
function formatFetchThreadMessagesFewShotExample(hasThreadContext: boolean): string {
  if (!hasThreadContext) {
    return '';
  }
  
  return `
### Case G: Thread Summarization
**User:** "Summarize this thread" (when in thread context)
**Step 1:** Call <tool>fetch_thread_messages</tool>() - no parameters needed
**Response:**
{
  "summary": "This thread discusses the API v2 migration plan. The team agreed on a phased rollout starting with auth endpoints.",
  "keypoints": [
    "**Migration Timeline** - Team decided on 3-month gradual migration with v1 deprecation after 6 months",
    "**Auth Endpoints First** - Alice proposed starting with authentication endpoints due to lower complexity",
    "**Documentation** - Bob volunteered to update API docs before the migration begins"
  ],
  "citations": {
    "1": "A3",
    "2": "A7",
    "3": "A12"
  }
}`;
}

export function buildAgentTemplateVariables(
  _source: SourceType,
  currentTimestamp?: string,
  userInfo?: UserInfo,
  channelNames?: string[],
  webSearchEnabled?: boolean,
  researchContext?: ResearchContext,
  researchOptions?: AvailableResearchOptions,
  customInstruction?: string,
  hasThreadContext?: boolean
): Record<string, string> {
  const variables = {
    current_timestamp: currentTimestamp || getCurrentTimestamp(),
    user_info: formatUserInfo(userInfo),
    channel_context: formatChannelContext(channelNames),
    custom_instructions: formatCustomInstructions(customInstruction),
    thread_context: formatThreadContext(hasThreadContext || false),
    fetch_thread_messages_instructions: formatFetchThreadMessagesInstructions(hasThreadContext || false),
    fetch_thread_messages_few_shot_example: formatFetchThreadMessagesFewShotExample(hasThreadContext || false),
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

