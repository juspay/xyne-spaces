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

import { getXyneAITools, type XyneAIAgentContext, type UserInfo } from './tools/index.js';

import {
  getPromptFromLangfuse,
  PROMPT_NAMES,
  buildAgentTemplateVariables,
} from './langfuse/index.js';
import {logger} from '@/utils/logger';

// ============================================================================
// Configuration
// ============================================================================

const LITELLM_BASE_URL = config.litellm.baseUrl;
const LITELLM_API_KEY = config.litellm.apiKey;
const MODEL_NAME = 'minimaxai/minimax-m2';

// ============================================================================
// Model Provider
// ============================================================================

function createModelProvider() {
  return makeLiteLLMProvider(LITELLM_BASE_URL, LITELLM_API_KEY);
}

// ============================================================================
// Agent Definition
// ============================================================================

function createXyneAIAgent(systemPrompt: string): Agent<XyneAIAgentContext, string> {
  return {
    name: 'XyneAI',
    instructions: () => systemPrompt,
    tools: getXyneAITools(),
    modelConfig: {
      temperature: 0.3,
    },
  };
}

async function buildAgentPrompt(
  source: 'thread' | 'channel',
  timestamp?: string,
  userInfo?: UserInfo,
  channelNames?: string[]
): Promise<string> {
  const templateVariables = buildAgentTemplateVariables(source, timestamp, userInfo, channelNames);
  
  const prompt = await getPromptFromLangfuse(PROMPT_NAMES.XYNE_AI_SYSTEM, {
    templateVariables,
  });
  
  if (!prompt) {
    logger.warn(`[XyneAI] Agent prompt '${PROMPT_NAMES.XYNE_AI_SYSTEM}' not available, using minimal default`);
    return `You are Xyne AI, an intelligent assistant. Current timestamp: ${timestamp || new Date().toISOString()}. ${channelNames && channelNames.length > 0 ? `Current channels: ${channelNames.join(', ')}` : 'No channels in context.'}`;
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
  onEvent?: (event: TraceEvent) => void
): RunConfig<XyneAIAgentContext> {
  return {
    agentRegistry,
    modelProvider: createModelProvider() as RunConfig<XyneAIAgentContext>['modelProvider'],
    maxTurns: 5,
    modelOverride: MODEL_NAME,
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

export async function createAgentRunner(
  source: 'thread' | 'channel',
  context: XyneAIAgentContext,
  messages: Message[],
  onEvent?: (event: TraceEvent) => void
) {
  const { channelNames, contextChannelMap, contextChannelIdToName } = await getChannelInfo(context.channelIds);
  
  // Add the pre-computed channel maps to context
  const enrichedContext: XyneAIAgentContext = {
    ...context,
    contextChannelMap,
    contextChannelIdToName,
  };
  
  const systemPrompt = await buildAgentPrompt(source, context.timestamp, context.userInfo, channelNames);
  const agent = createXyneAIAgent(systemPrompt);
  const agentRegistry = createAgentRegistry(agent);
  const runConfig = createRunConfig(agentRegistry, onEvent);
  const initialState = createInitialState(enrichedContext, messages);
  
  return runStream(initialState, runConfig);
}
