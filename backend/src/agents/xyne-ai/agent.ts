/**
 * Xyne AI Agent - Configuration and Setup
 */

import {
  makeLiteLLMProvider,
  generateRunId,
  generateTraceId,
  runStream,
  type Agent,
  type RunState,
  type RunConfig,
  type Message,
  type TraceEvent,
} from '@xynehq/jaf';

import { config } from '../../config/env.js';
import { db } from '../../database/client.js';

import { getXyneAITools, type XyneAIAgentContext, type UserInfo, type ResearchContext } from './tools/index.js';
import { researchAgentService } from '../../services/researchAgentService.js';

import {
  getPromptFromLangfuse,
  PROMPT_NAMES,
  buildAgentTemplateVariables,
  type AvailableResearchOptions,
} from './langfuse/index.js';
import {logger} from '@/utils/logger';

// ============================================================================
// Configuration
// ============================================================================

const LITELLM_BASE_URL = config.litellm.baseUrl;

// ============================================================================
// Model Provider
// ============================================================================

function createModelProvider(apiKey: string) {
  return makeLiteLLMProvider(LITELLM_BASE_URL, apiKey);
}

// ============================================================================
// Agent Definition
// ============================================================================

function createXyneAIAgent(systemPrompt: string, webSearchEnabled?: boolean, hasThreadContext?: boolean): Agent<XyneAIAgentContext, string> {
  return {
    name: 'XyneAI',
    instructions: () => systemPrompt,
    tools: getXyneAITools({ webSearchEnabled, hasThreadContext }),
    modelConfig: {
      temperature: 0.3,
    },
  };
}

async function buildAgentPrompt(
  source: 'thread' | 'channel',
  timestamp?: string,
  userInfo?: UserInfo,
  channelNames?: string[],
  webSearchEnabled?: boolean,
  researchContext?: ResearchContext,
  researchOptions?: AvailableResearchOptions,
  customInstruction?: string,
  hasThreadContext?: boolean
): Promise<string> {
  const templateVariables = buildAgentTemplateVariables(source, timestamp, userInfo, channelNames, webSearchEnabled, researchContext, researchOptions, customInstruction, hasThreadContext);
  
  const prompt = await getPromptFromLangfuse(PROMPT_NAMES.XYNE_AI_SYSTEM, {
    templateVariables,
  });
  
  if (!prompt) {
    logger.warn(`[XyneAI] Agent prompt '${PROMPT_NAMES.XYNE_AI_SYSTEM}' not available, using minimal default`);
    const researchInfo = researchContext ? ` Current ${researchContext.type}: "${researchContext.name}".` : '';
    return `You are Xyne AI, an intelligent assistant. Current timestamp: ${timestamp || new Date().toISOString()}. ${channelNames && channelNames.length > 0 ? `Current channels: ${channelNames.join(', ')}.` : 'No channels in context.'}${researchInfo}`;
  }
  
  return prompt;
}

// ============================================================================
// Agent Registry
// ============================================================================

function createAgentRegistry(agent: Agent<XyneAIAgentContext, unknown>) {
  return new Map<string, Agent<XyneAIAgentContext, unknown>>([
    ['XyneAI', agent],
  ]);
}

// ============================================================================
// Run Configuration
// ============================================================================

function createRunConfig(
  agentRegistry: Map<string, Agent<XyneAIAgentContext, unknown>>,
  modelName: string,
  apiKey: string,
  onEvent?: (event: TraceEvent) => void
): RunConfig<XyneAIAgentContext> {
  return {
    agentRegistry,
    modelProvider: createModelProvider(apiKey) as RunConfig<XyneAIAgentContext>['modelProvider'],
    maxTurns: 50,
    modelOverride: modelName,
    onEvent,
  };
}

function createInitialState(
  context: XyneAIAgentContext,
  messages: Message[]
): RunState<XyneAIAgentContext> {
  return {
    runId: generateRunId(),
    traceId: generateTraceId(),
    messages,
    currentAgentName: 'XyneAI',
    context,
    turnCount: 0,
  };
}
/**
 * Fetch channel info from channel IDs - returns both names and a map for lookups
 */
async function getChannelInfo(channelIds: string[]): Promise<{
  channelNames: string[];
  contextChannelMap: Map<string, string>;
  contextChannelIdToName: Map<string, string>;
}> {
  if (!channelIds || channelIds.length === 0) {
    return { channelNames: [], contextChannelMap: new Map(), contextChannelIdToName: new Map() };
  }
  
  const channels = await db.channel.findMany({
    where: { id: { in: channelIds } },
    select: { id: true, name: true },
  });
  
  const channelNames = channels.map(c => c.name);
  const contextChannelMap = new Map(channels.map(c => [c.name.toLowerCase(), c.id]));
  const contextChannelIdToName = new Map(channels.map(c => [c.id, c.name]));
  
  return { channelNames, contextChannelMap, contextChannelIdToName };
}

// ============================================================================
// Agent Runner
// ============================================================================

/**
 * Fetch available products and repositories from Research Agent at runtime
 * Returns both the display names (for prompt) and name→ID mappings (for tool)
 */
async function fetchResearchData(): Promise<{
  researchOptions: AvailableResearchOptions;
  productNameToId: Map<string, string>;
  repositoryNameToId: Map<string, string>;
}> {
  try {
    const [products, repositories] = await Promise.all([
      researchAgentService.listProducts().catch(() => []),
      researchAgentService.listRepositories().catch(() => []),
    ]);
    
    return {
      researchOptions: {
        productNames: products.map(p => p.name),
        repositoryNames: repositories.map(r => r.name),
      },
      productNameToId: new Map(products.map(p => [p.name, p.id])),
      repositoryNameToId: new Map(repositories.map(r => [r.name, r.id])),
    };
  } catch (error) {
    logger.warn('[XyneAI] Failed to fetch research data:', error);
    return {
      researchOptions: { productNames: [], repositoryNames: [] },
      productNameToId: new Map(),
      repositoryNameToId: new Map(),
    };
  }
}

export async function createAgentRunner(
  source: 'thread' | 'channel',
  context: XyneAIAgentContext,
  messages: Message[],
  modelName: string,
  apiKey: string,
  onEvent?: (event: TraceEvent) => void
) {
  // Fetch channel info and research data in parallel (single API call for research)
  const [channelInfo, researchData] = await Promise.all([
    getChannelInfo(context.channelIds),
    fetchResearchData(),
  ]);
  
  const { channelNames, contextChannelMap, contextChannelIdToName } = channelInfo;
  const { researchOptions, productNameToId, repositoryNameToId } = researchData;

  // Add the pre-computed maps to context
  const enrichedContext: XyneAIAgentContext = {
    ...context,
    contextChannelMap,
    contextChannelIdToName,
    productNameToId,
    repositoryNameToId,
  };
  
  // Determine if we have thread context (conversationId is present)
  const hasThreadContext = !!context.conversationId;
  
  const systemPrompt = await buildAgentPrompt(
    source, 
    context.timestamp, 
    context.userInfo, 
    channelNames, 
    context.webSearchEnabled,
    context.researchContext,
    researchOptions,
    context.customInstruction,
    hasThreadContext
  );
  const agent = createXyneAIAgent(systemPrompt, context.webSearchEnabled, hasThreadContext);
  const agentRegistry = createAgentRegistry(agent);
  const runConfig = createRunConfig(agentRegistry, modelName, apiKey, onEvent);
  const initialState = createInitialState(enrichedContext, messages);

  return runStream(initialState, runConfig);
}
