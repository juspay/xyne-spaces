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
} from '@juspay-jaf/jaf';

import { config } from '../../config/env.js';
import { db } from '../../database/client.js';

import { getXyneAITools, type XyneAIAgentContext, type UserInfo, type ResearchContext } from './tools/index.js';
import { researchAgentService } from '../../services/researchAgentService.js';
import type { ProvidedContexts } from './utils/contextFetcher.js';
import { getChannelInfo } from './utils/channelResolver.js';

import {
  getPromptFromLangfuse,
  PROMPT_NAMES,
  buildAgentTemplateVariables,
  type AvailableResearchOptions,
} from './langfuse/index.js';
import { getSystemSkills } from './langfuse/system-skills.js';
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

function createXyneAIAgent(systemPrompt: string, webSearchEnabled?: boolean, deepResearchEnabled?: boolean, hasThreadContext?: boolean): Agent<XyneAIAgentContext, string> {
  return {
    name: 'XyneAI',
    instructions: () => systemPrompt,
    tools: getXyneAITools({ webSearchEnabled, deepResearchEnabled, hasThreadContext }),
    modelConfig: {
      temperature: 0.3,
    },
  };
}

interface Skill {
  name: string;
  description: string | null;
  instructions: string | null;
  enabled: boolean;
}

async function fetchUserSkills(userId: string): Promise<Skill[]> {
  try {
    const [systemSkills, dbSkills] = await Promise.all([
      getSystemSkills(),
      db.userSkill.findMany({
        where: { userId, enabled: true },
        select: { name: true, description: true, instructions: true, enabled: true },
      }),
    ]);

    // System skills take priority — put them first
    return [
      ...systemSkills.map(s => ({ ...s, enabled: true })),
      ...dbSkills,
    ];
  } catch (error) {
    logger.warn('[XyneAI] Failed to fetch user skills:', error);
    return [];
  }
}

async function buildAgentPrompt(
  source: 'thread' | 'channel',
  timestamp?: string,
  userInfo?: UserInfo,
  channelNames?: string[],
  webSearchEnabled?: boolean,
  deepResearchEnabled?: boolean,
  researchContext?: ResearchContext,
  researchOptions?: AvailableResearchOptions,
  customInstruction?: string,
  hasThreadContext?: boolean,
  userId?: string,
  promptName?: string,
  providedContexts?: ProvidedContexts
): Promise<string> {
  // Fetch user skills if userId is provided
  const skills = userId ? await fetchUserSkills(userId) : [];

  const templateVariables = buildAgentTemplateVariables(
    source,
    timestamp,
    userInfo,
    channelNames,
    webSearchEnabled,
    deepResearchEnabled, researchContext,
    researchOptions,
    customInstruction,
    hasThreadContext,
    skills,
    providedContexts
  );

  const prompt = await getPromptFromLangfuse(promptName ?? PROMPT_NAMES.XYNE_AI_SYSTEM, {
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
  onEvent?: (event: TraceEvent) => void,
  providedContexts?: ProvidedContexts
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
  
  const systemPrompt = context.systemPrompt ?? await buildAgentPrompt(
    source,
    context.timestamp,
    context.userInfo,
    channelNames,
    context.webSearchEnabled,
    context.deepResearchEnabled,
    context.researchContext,
    researchOptions,
    context.customInstruction,
    hasThreadContext,
    context.userId,
    context.agentPromptName,
    providedContexts
  );
  const agent = createXyneAIAgent(systemPrompt, context.webSearchEnabled, context.deepResearchEnabled, hasThreadContext);
  const agentRegistry = createAgentRegistry(agent);
  const runConfig = createRunConfig(agentRegistry, modelName, apiKey, onEvent);
  const initialState = createInitialState(enrichedContext, messages);

  return runStream(initialState, runConfig);
}
