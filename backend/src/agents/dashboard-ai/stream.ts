import {
  DashboardToolCallSchema,
  type DashboardAiEvent,
  type DashboardPlan,
} from '@xyne/shared';
import { LLMClient, createUserMessage } from '@framework';
import { config } from '@/config/env';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { findWorkspaceDataSource } from '@/services/dynamicDashboard/dataSource/DataSourceService';
import { AgentsConfig } from '../config.js';
import { logLLMCallStart, logLLMSuccess, logLLMError } from '../agentLogger.js';
import { buildSystemPrompt, buildUserMessage } from './prompts.js';
import { TOOL_DEFINITIONS } from './tools.js';

const AGENT_NAME = 'DashboardAI';

export interface DashboardAiStreamArgs {
  prompt: string;
  dataSourceId: string;
  workspaceId: string;
  currentPlan?: DashboardPlan;
  lastError?: string;
  sendEvent: (event: DashboardAiEvent) => void;
  abortSignal?: AbortSignal;
}

export async function dashboardAiStream(args: DashboardAiStreamArgs): Promise<void> {
  const { prompt, dataSourceId, workspaceId, currentPlan, lastError, sendEvent, abortSignal } = args;

  const { apiKey, baseUrl } = config.litellm;
  if (!apiKey || !baseUrl) {
    throw new Error('LiteLLM not configured (LITELLM_API_KEY / LITELLM_BASE_URL empty)');
  }

  const ds = await findWorkspaceDataSource(dataSourceId, workspaceId);
  if (!ds) throw new Error(`Data source ${dataSourceId} not found`);

  const cacConfig = await AgentsConfig.fetch().catch(() => AgentsConfig.defaults());

  const [tables, totalTableCount] = await Promise.all([
    db.dataSourceTable.findMany({
      where: { dataSourceId },
      include: { columns: true },
      orderBy: [{ schemaName: 'asc' }, { tableName: 'asc' }],
      take: cacConfig.dataSourceIngestTableLimit,
    }),
    db.dataSourceTable.count({ where: { dataSourceId } }),
  ]);
  if (tables.length === 0) {
    sendEvent({
      type: 'delta',
      content:
        "I don't see any introspected tables on this data source yet — make sure ingestion has completed.",
    });
    sendEvent({ type: 'complete', summary: 'No tables found.' });
    return;
  }

  const relationships = await db.dataSourceRelationship.findMany({
    where: { dataSourceId },
    include: {
      fromColumn: { include: { table: true } },
      toColumn: { include: { table: true } },
    },
  });

  const systemPrompt = buildSystemPrompt({
    dataSourceName: ds.name,
    dataSourceId,
    sourceType: ds.sourceType,
    tables,
    totalTableCount,
    relationships,
  });
  const userMessage = buildUserMessage(prompt, currentPlan, lastError);

  const modelName = cacConfig.dashboardAiModelName;

  const llmClient = new LLMClient({
    provider: {
      type: 'litellm',
      config: {
        apiKey,
        baseUrl,
        timeout: config.dashboard.aiRequestTimeoutMs,
      },
    },
    defaultModel: modelName,
  });

  logLLMCallStart(AGENT_NAME, modelName, 'LITELLM_API_KEY');

  let response;
  try {
    response = await llmClient.generate({
      messages: [createUserMessage(userMessage)],
      systemPrompt,
      tools: TOOL_DEFINITIONS,
      parameters: { temperature: config.dashboard.aiTemperature },
      extraBody: {
        parallel_tool_calls: true,
        chat_template_kwargs: { enable_thinking: false },
      },
      ...(abortSignal ? { abortSignal } : {}),
    });
    logLLMSuccess(AGENT_NAME, response.content);
  } catch (error) {
    logLLMError(AGENT_NAME, error);
    throw error;
  }

  if (response.content) {
    sendEvent({ type: 'delta', content: response.content });
  }

  for (const tc of response.toolCalls ?? []) {
    const parsed = DashboardToolCallSchema.safeParse({
      tool: tc.name,
      args: tc.arguments,
    });
    if (!parsed.success) {
      logger.warn('[DashboardAI/LLM] tool call failed schema', {
        toolName: tc.name,
        issues: parsed.error.issues,
      });
      sendEvent({
        type: 'error',
        message: `AI emitted invalid args for ${tc.name}: ${parsed.error.issues
          .map(i => `${i.path.join('.')}: ${i.message}`)
          .slice(0, 3)
          .join('; ')}`,
        recoverable: true,
      });
      continue;
    }
    sendEvent({ type: 'tool_call', call: parsed.data });
  }

  sendEvent({ type: 'complete' });
}
