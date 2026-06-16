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

function createXyneAIAgent(systemPrompt: string, webSearchEnabled?: boolean, deepResearchEnabled?: boolean, hasThreadContext?: boolean, memoryEnabled?: boolean, disableTools?: boolean): Agent<XyneAIAgentContext, string> {
  return {
    name: 'XyneAI',
    instructions: () => systemPrompt,
    tools: disableTools ? [] : getXyneAITools({ webSearchEnabled, deepResearchEnabled, hasThreadContext, memoryEnabled }),
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
  providedContexts?: ProvidedContexts,
  hasChannels?: boolean,
  knowledgeBaseEnabled?: boolean
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
    providedContexts,
    hasChannels, 
    knowledgeBaseEnabled
  );

  // 'ask-ai' is the agent identifier; the Langfuse prompt is still registered as 'xyne-ai'
  const langfusePromptName = promptName === 'ask-ai' ? PROMPT_NAMES.XYNE_AI_SYSTEM : (promptName ?? PROMPT_NAMES.XYNE_AI_SYSTEM);
  const prompt = await getPromptFromLangfuse(langfusePromptName, {
    templateVariables,
  });
  
  if (!prompt) {
    logger.warn(`[XyneAI] Agent prompt '${PROMPT_NAMES.XYNE_AI_SYSTEM}' not available, using minimal default`);
    const researchInfo = researchContext ? ` Current ${researchContext.type}: "${researchContext.name}".` : '';
    return `You are Xyne AI, an intelligent assistant. Current timestamp: ${timestamp || new Date().toISOString()}. ${channelNames && channelNames.length > 0 ? `Current channels: ${channelNames.join(', ')}.` : 'No channels in context.'}${researchInfo}`;
  }
  
  return prompt;
}

/**
 * When Ask AI is opened from a single file (fileIds in scope), the file search is
 * already filtered to that document. But the agent doesn't otherwise know a document
 * is in focus, so on referential queries ("tell me about this doc") it asks the user
 * for a link instead of searching. This instruction primes it to treat the scoped
 * file as the implicit subject and use search_files proactively.
 */
async function buildFocusedFileInstruction(fileIds: string[]): Promise<string> {
  let names: string[] = [];
  try {
    const items = await db.collectionItem.findMany({
      where: { fileId: { in: fileIds }, isLatest: true },
      select: { name: true },
    });
    names = items.map(i => i.name).filter(Boolean);
  } catch (error) {
    logger.warn('[XyneAI] Failed to resolve focused file name(s):', error);
  }

  const subject =
    names.length === 1
      ? `the file "${names[0]}"`
      : names.length > 1
        ? `these files: ${names.map(n => `"${n}"`).join(', ')}`
        : 'the document the user is currently viewing';

  return [
    '## Focused document',
    `The user is currently viewing ${subject}, and your file search (search_files) is ALREADY scoped to it.`,
    'When the user says "this doc", "this file", "this PDF", or refers to "it" without naming a source, they mean this document — do NOT ask them for a link or which document they mean.',
    'Always call search_files (it is auto-scoped to this document) with a query derived from their question, then answer from the returned chunks. For a broad request like "tell me about this doc", search with general terms (e.g. the title or "overview summary main points") to pull its main content.',
  ].join('\n');
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
  
  // Determine if we have channels selected
  const hasChannels = !!(context.channelIds && context.channelIds.length > 0);

  // Enable knowledge base tool if collectionIds are provided
  const knowledgeBaseEnabled = !!(context.collectionIds && context.collectionIds.length > 0);

  // If a systemPromptOverride is provided (e.g. draft mode), use it directly
  // and skip the standard prompt-builder logic.
  let systemPrompt = context.systemPromptOverride
    ? context.systemPromptOverride
    : await buildAgentPrompt(
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
        context.agentName,
        providedContexts,
    hasChannels,
    knowledgeBaseEnabled
      );

  // When opened from a single file, tell the agent which document is in focus so it
  // searches the (already file-scoped) content instead of asking the user for a link.
  if (!context.systemPromptOverride && context.fileIds && context.fileIds.length > 0) {
    const focusedFileInstruction = await buildFocusedFileInstruction(context.fileIds);
    systemPrompt = `${systemPrompt}\n\n${focusedFileInstruction}`;
    logger.info(
      `[AskAI:trace] [${context.sessionId}] STEP 2 → focused-document instruction injected for fileIds=${JSON.stringify(context.fileIds)}; agent told to call search_files (auto-scoped) instead of asking for a link`,
    );
  }

  const agent = createXyneAIAgent(systemPrompt, context.webSearchEnabled, context.deepResearchEnabled, hasThreadContext, context.memoryEnabled, context.disableTools);
  const agentRegistry = createAgentRegistry(agent);
  const runConfig = createRunConfig(agentRegistry, modelName, apiKey, onEvent);
  const initialState = createInitialState(enrichedContext, messages);

  return runStream(initialState, runConfig);
}
