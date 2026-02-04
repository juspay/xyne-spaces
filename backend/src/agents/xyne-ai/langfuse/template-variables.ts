/**
 * Template Variables for Langfuse Prompts
 */

import type { UserInfo } from '../tools/index.js';

export type SourceType = 'thread' | 'channel';

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

export function buildAgentTemplateVariables(
  _source: SourceType,
  currentTimestamp?: string,
  userInfo?: UserInfo,
  channelNames?: string[]
): Record<string, string> {
  const variables = {
    current_timestamp: currentTimestamp || getCurrentTimestamp(),
    user_info: formatUserInfo(userInfo),
    channel_context: formatChannelContext(channelNames),
  };
  
  return variables;
}

export function buildToolTemplateVariables(_toolName: string): Record<string, string> | undefined {
  return undefined;
}
