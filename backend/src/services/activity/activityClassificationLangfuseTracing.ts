import {
  startObservation,
  type LangfuseGeneration,
} from '@langfuse/tracing';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import type { TraceEvent } from '@xynehq/jaf';

export interface ActivityClassificationLangfuseConfig {
  secretKey: string;
  publicKey: string;
  baseUrl: string;
  enabled: boolean;
}

export const getActivityClassificationLangfuseConfig = (): ActivityClassificationLangfuseConfig => {
  return {
    secretKey: config.langfuse.secretKey,
    publicKey: config.langfuse.publicKey,
    baseUrl: config.langfuse.baseUrl || 'https://cloud.langfuse.com',
    enabled: Boolean(config.langfuse.secretKey && config.langfuse.publicKey),
  };
};

let nodeSDK: NodeSDK | null = null;
let isInitialized = false;

export const initializeActivityClassificationTracing = (): void => {
  if (isInitialized) {
    return;
  }

  const langfuseConfig = getActivityClassificationLangfuseConfig();
  if (!langfuseConfig.enabled) {
    logger.warn(
      '[ActivityClassification][Langfuse] Tracing not configured. Set LANGFUSE_SECRET_KEY and LANGFUSE_PUBLIC_KEY to enable.'
    );
    return;
  }

  try {
    nodeSDK = new NodeSDK({
      spanProcessors: [new LangfuseSpanProcessor()],
      serviceName: 'activity-classification',
    });

    nodeSDK.start();
    isInitialized = true;

    logger.info('[ActivityClassification][Langfuse] Tracing initialized');
    logger.info(`[ActivityClassification][Langfuse] Base URL: ${langfuseConfig.baseUrl}`);
  } catch (error) {
    logger.error('[ActivityClassification][Langfuse] Failed to initialize tracing', error);
  }
};

export const shutdownActivityClassificationTracing = async (): Promise<void> => {
  if (!nodeSDK) return;

  try {
    await nodeSDK.shutdown();
    logger.info('[ActivityClassification][Langfuse] Tracing shut down');
  } catch (error) {
    logger.error('[ActivityClassification][Langfuse] Failed to shutdown tracing', error);
  } finally {
    nodeSDK = null;
    isInitialized = false;
  }
};

const activeObservations = new Map<
  string,
  {
    runSpan: LangfuseGeneration;
  }
>();

export const createActivityClassificationOnEventHandler = (): ((event: TraceEvent) => void) => {
  if (!getActivityClassificationLangfuseConfig().enabled) {
    return () => {};
  }

  initializeActivityClassificationTracing();

  return (event: TraceEvent) => {
    try {
      handleLangfuseEvent(event);
    } catch (error) {
      logger.error('[ActivityClassification][Langfuse] Failed to handle trace event', error);
    }
  };
};

const handleLangfuseEvent = (event: TraceEvent): void => {
  switch (event.type) {
    case 'run_start': {
      const { runId, traceId, context, messages } = event.data;

      const runSpan = startObservation(
        'activity-classification-run',
        {
          input: messages ? JSON.stringify(messages) : undefined,
          metadata: {
            runId,
            traceId,
            activityId: context?.activityId,
            jobType: context?.jobType,
            actorAction: context?.actorAction,
          },
        },
        { asType: 'generation' }
      ) as LangfuseGeneration;

      activeObservations.set(runId, { runSpan });
      break;
    }

    case 'llm_call_start': {
      const { runId, agentName, model, messages } = event.data;
      const state = activeObservations.get(runId);

      if (state?.runSpan) {
        state.runSpan.update({
          input: messages ? JSON.stringify(messages) : undefined,
          metadata: {
            model,
            agentName: agentName ?? 'ActivityClassification',
          },
        });
      }
      break;
    }

    case 'llm_call_end': {
      const { runId, choice, usage } = event.data;
      const state = activeObservations.get(runId);
      if (state?.runSpan) {
        const usageDetails: Record<string, number> = {};
        if (usage?.prompt_tokens) usageDetails.input = usage.prompt_tokens;
        if (usage?.completion_tokens) usageDetails.output = usage.completion_tokens;
        if (usage?.total_tokens) usageDetails.total = usage.total_tokens;

        state.runSpan.update({
          output: choice?.message?.content,
          usageDetails: Object.keys(usageDetails).length > 0 ? usageDetails : undefined,
        });
      }
      break;
    }

    case 'run_end': {
      const { runId, outcome } = event.data;
      const state = activeObservations.get(runId);
      if (state?.runSpan) {
        state.runSpan.update({
          output: outcome.status === 'error' ? JSON.stringify({ error: outcome.error }) : undefined,
          metadata: { status: outcome.status },
        });

        state.runSpan.end();
        activeObservations.delete(runId);
      }
      break;
    }

    default:
      break;
  }
};
