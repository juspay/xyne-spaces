/**
 * Langfuse Prompt Management for Xyne AI Agent
 * 
 * Supports graceful fallback to hardcoded prompts when Langfuse is not configured.
 */

import { LangfuseClient } from '@langfuse/client';
import { logger } from '../../../utils/logger.js';
import { getLangfuseConfig } from './config.js';
import { compileFallbackPrompt } from './fallback-prompts.js';

const DEFAULT_PROMPT_CACHE_TTL = parseInt(process.env.LANGFUSE_PROMPT_CACHE_TTL || '300', 10) * 1000;

let langfuseClient: LangfuseClient | null = null;

export function getLangfuseClient(): LangfuseClient | null {
  const config = getLangfuseConfig();
  
  if (!config.enabled) {
    logger.debug('[Langfuse] Client not available - using fallback prompts');
    return null;
  }
  
  if (!langfuseClient) {
    langfuseClient = new LangfuseClient();
  }
  
  return langfuseClient;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const promptCache = new Map<string, { prompt: any; cachedAt: number; ttl: number }>();

function getCacheKey(name: string, label: string): string {
  return `${name}:${label}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getPrompt(
  promptName: string, 
  label = 'production',
  cacheTtlSeconds?: number
): Promise<any | null> {
  const client = getLangfuseClient();
  const cacheKey = getCacheKey(promptName, label);
  const cacheTtl = cacheTtlSeconds !== undefined ? cacheTtlSeconds * 1000 : DEFAULT_PROMPT_CACHE_TTL;
  
  if (!client) {
    logger.debug(`[Langfuse] Client not configured, skipping prompt fetch for: ${promptName}`);
    return null;
  }
  
  const cached = promptCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < cached.ttl) {
    logger.debug(`[Langfuse] Using cached prompt: ${promptName} (label: ${label})`);
    return cached.prompt;
  }
  
  try {
    const prompt = await client.prompt.get(promptName, { label, cacheTtlSeconds });
    promptCache.set(cacheKey, { prompt, cachedAt: Date.now(), ttl: cacheTtl });
    logger.info(`[Langfuse] Fetched prompt: ${promptName} (label: ${label})`);
    return prompt;
  } catch (error) {
    logger.error(`[Langfuse] Failed to fetch prompt '${promptName}' (label: ${label}):`);
    return null;
  }
}

export interface GetPromptOptions {
  label?: string;
  templateVariables?: Record<string, string>;
  cacheTtlSeconds?: number;
}

export async function getPromptFromLangfuse(
  name: string,
  options: GetPromptOptions = {}
): Promise<string | null> {
  const { label = 'production', templateVariables, cacheTtlSeconds } = options;
  
  // If Langfuse is not configured, use fallback prompts
  const config = getLangfuseConfig();
  if (!config.enabled) {
    const fallback = compileFallbackPrompt(name, templateVariables);
    if (fallback) {
      logger.debug(`[Langfuse] Using fallback prompt for '${name}'`);
      return fallback;
    }
    logger.warn(`[Langfuse] No fallback prompt available for '${name}'`);
    return null;
  }
  
  try {
    const prompt = await getPrompt(name, label, cacheTtlSeconds);
    
    if (!prompt) {
      // Try fallback if Langfuse prompt not found
      const fallback = compileFallbackPrompt(name, templateVariables);
      if (fallback) {
        logger.warn(`[Langfuse] Prompt '${name}' not found, using fallback`);
        return fallback;
      }
      logger.warn(`[Langfuse] Prompt '${name}' not found in Langfuse and no fallback available`);
      return null;
    }
    
    let promptContent = prompt.prompt;
    
    if (templateVariables) {
      try {
        promptContent = prompt.compile(templateVariables);
      } catch (formatError) {
        logger.error(`[Langfuse] Error formatting prompt '${name}':`, formatError);
      }
    }
    
    return typeof promptContent === 'string' ? promptContent : null;
  } catch (error) {
    logger.error(`[Langfuse] Error retrieving prompt '${name}' (label: ${label}):`, error);
    // Try fallback on error
    const fallback = compileFallbackPrompt(name, templateVariables);
    if (fallback) {
      logger.warn(`[Langfuse] Using fallback prompt for '${name}' after error`);
      return fallback;
    }
    return null;
  }
}

export async function compilePrompt(
  promptName: string, 
  variables: Record<string, string>
): Promise<string | string[] | null> {
  const prompt = await getPrompt(promptName);
  
  if (!prompt) {
    return null;
  }
  
  try {
    return prompt.compile(variables) as string | string[];
  } catch (error) {
    logger.error(`[Langfuse] Failed to compile prompt '${promptName}':`, error);
    return null;
  }
}

export const PROMPT_NAMES = {
  XYNE_AI_SYSTEM: 'xyne-ai',
  FETCH_CHANNEL_MESSAGES: 'fetch_channel_messages',
  FETCH_CHANNEL_MESSAGES_RECAP: 'fetch_channel_messages_recap',
  FETCH_THREAD_MESSAGES: 'fetch_thread_messages',
  FETCH_LINK_CONTENT: 'fetch_link_content',
  SEARCH_RELEVANT_MESSAGES: 'search_relevant_messages',
  SEARCH_GMAIL: 'search_gmail',
  GENERATE_TEAM_INTELLIGENCE_REPORT: 'generate_team_intelligence_report',
  SEARCH_RELEVANT_TICKETS: 'search_relevant_tickets',
  SEARCH_MEETING_INSIGHTS: 'search_meeting_insights',
  GENIUS: 'genius_as_tool',
  XYNE_RCA: 'xyne_rca',
  FIELD_VALUE_DISCOVERY: 'field_value_discovery',
  WEB_SEARCH: 'web_search',
  RESEARCH_AGENT: 'research_agent',
  CREATE_CANVAS: 'create_canvas',
  READ_CANVAS: 'read_canvas',
  EDIT_CANVAS: 'edit_canvas',
  CREATE_PPT: 'create_ppt',
  TICKET_DESCRIPTION_CLEANER: 'ticket_description_cleaner',
  CLUSTER_THEME_SINGLE: 'cluster_theme_single',
  META_THEME_SINGLE: 'meta_theme_single',
  NUDGE_EXTRACTOR: 'nudge_extractor',
} as const;

export type PromptName = typeof PROMPT_NAMES[keyof typeof PROMPT_NAMES];

export async function prefetchPrompts(): Promise<void> {
  const client = getLangfuseClient();
  
  if (!client) {
    logger.info('[Langfuse] Prompt prefetch skipped - client not configured');
    return;
  }
  
  logger.info('[Langfuse] Prefetching prompts...');
  
  const promptNames = Object.values(PROMPT_NAMES);
  const results = await Promise.allSettled(
    promptNames.map(name => getPrompt(name))
  );
  
  const successful = results.filter(r => r.status === 'fulfilled' && r.value !== null).length;
  const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value === null)).length;
  
  logger.info(`[Langfuse] Prefetch complete: ${successful} loaded, ${failed} not found/failed`);
}

export function clearPromptCache(): void {
  promptCache.clear();
  logger.info('[Langfuse] Prompt cache cleared');
}
