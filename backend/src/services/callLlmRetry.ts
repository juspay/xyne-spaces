import {
  Agent,
  LLMClient,
  createUserMessage,
} from '@framework';
import { config } from '@/config/env';
import { extractAgentContent } from '@/utils/agentUtils';
import { logger } from '@/utils/logger';

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 120_000; // 2 minutes
const MAX_DELAY_MS = 960_000; // 16 minutes
const DEFAULT_MODEL = 'glm-latest';

type ExtractedContent = ReturnType<typeof extractAgentContent>;

export type StreamingLlmFailureReason =
  | 'cancelled'
  | 'empty_content'
  | 'litellm_credentials_missing'
  | 'exception'
  | 'exhausted';

export type StreamingLlmResult =
  | { ok: true; content: string }
  | { ok: false; reason: StreamingLlmFailureReason; error?: string };

export interface ExecuteStreamingLlmOptions {
  userPrompt: string;
  systemPrompt?: string;
  operation: string;
  callId?: string;
  abortSignal?: AbortSignal;
}

let streamingLlmClient: LLMClient | null = null;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const getRetryDelayMs = (attempt: number): number => {
  const baseDelay = BASE_DELAY_MS * 2 ** (attempt - 1);
  const jitter = Math.random() * 0.3 * baseDelay;
  return Math.min(baseDelay + jitter, MAX_DELAY_MS);
};

const failedResult = (status: string): ExtractedContent =>
  ({
    ok: false,
    reason: 'bad_status',
    status,
  }) as ExtractedContent;

const getErrorDetails = (error: unknown) => ({
  error: error instanceof Error ? error.message : String(error),
  stack: error instanceof Error ? error.stack : undefined,
});

async function waitBeforeRetry(
  callId: string,
  operation: string,
  attempt: number,
  abortSignal?: AbortSignal
): Promise<boolean> {
  const delay = getRetryDelayMs(attempt);

  logger.info(`[${callId}] ${operation}_retry_delay`, {
    attempt,
    delay_ms: delay,
  });

  if (!abortSignal) {
    await sleep(delay);
    return true;
  }

  if (abortSignal.aborted) {
    return false;
  }

  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timeout);
      resolve(false);
    };
    const timeout = setTimeout(() => {
      abortSignal.removeEventListener('abort', onAbort);
      resolve(true);
    }, delay);

    abortSignal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function executeCallLlmWithRetry(
  createAgent: () => Agent | null | Promise<Agent | null>,
  buildPrompt: () => string,
  operation: string,
  callId: string,
): Promise<ExtractedContent> {
  const logCallId = callId || 'unknown';
  const totalStart = Date.now();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptStart = Date.now();
    const isLastAttempt = attempt === MAX_ATTEMPTS;

    logger.info(`[${logCallId}] ${operation}_attempt_started`, {
      attempt,
      max_attempts: MAX_ATTEMPTS,
    });

    try {
      const agent = await createAgent();

      if (!agent) {
        logger.error(`[${logCallId}] ${operation}_failed`, {
          reason: 'agent_creation_failed',
          attempt,
        });

        return failedResult('agent_creation_failed');
      }

      const result = await agent.execute({
        messages: [createUserMessage(buildPrompt())],
      });

      const extracted = extractAgentContent(result);

      if (extracted.ok) {
        logger.info(`[${logCallId}] ${operation}_success`, {
          attempts_used: attempt,
          duration_ms: Date.now() - attemptStart,
          total_duration_ms: Date.now() - totalStart,
        });

        return extracted;
      }

      logger.warn(`[${logCallId}] ${operation}_attempt_failed`, {
        attempt,
        max_attempts: MAX_ATTEMPTS,
        reason: extracted.reason,
        status: extracted.status ?? result.status,
        duration_ms: Date.now() - attemptStart,
      });

      if (isLastAttempt) {
        logger.error(`[${logCallId}] ${operation}_failed_after_retries`, {
          attempts: MAX_ATTEMPTS,
          reason: extracted.reason,
          status: extracted.status ?? result.status,
          total_duration_ms: Date.now() - totalStart,
        });

        return extracted;
      }
    } catch (error) {
      logger.warn(`[${logCallId}] ${operation}_attempt_threw`, {
        attempt,
        max_attempts: MAX_ATTEMPTS,
        ...getErrorDetails(error),
        duration_ms: Date.now() - attemptStart,
      });

      if (isLastAttempt) {
        logger.error(`[${logCallId}] ${operation}_failed_after_retries`, {
          attempts: MAX_ATTEMPTS,
          ...getErrorDetails(error),
          total_duration_ms: Date.now() - totalStart,
        });

        return failedResult('exception');
      }
    }

    await waitBeforeRetry(logCallId, operation, attempt);
  }

  return failedResult('exhausted');
}

/**
 * Returns a singleton LLMClient for streaming requests
 */
function getStreamingLlmClient(): LLMClient | null {
  const apiKey = config.llm.callLitellmApiKey;
  const baseUrl = config.llm.litellmBaseUrl;

  if (!apiKey || !baseUrl) {
    return null;
  }

  if (!streamingLlmClient) {
    streamingLlmClient = new LLMClient({
      provider: {
        type: 'litellm',
        config: {
          apiKey,
          baseUrl,
          timeout: config.llm.requestTimeoutMs,
        },
      },
      defaultModel: config.llm.callLitellmModel || DEFAULT_MODEL,
      retry: {
        maxAttempts: MAX_ATTEMPTS,
        baseDelay: BASE_DELAY_MS,
        maxDelay: MAX_DELAY_MS,
        exponentialBackoff: true,
      },
    });
  }

  return streamingLlmClient;
}

/**
 * Requests a streaming completion through the shared framework client,
 * consumes the stream, and returns the accumulated final message.
 * Retry behavior is delegated to the configured LLMClient.
 */
export async function executeStreamingLlmRequest(
  options: ExecuteStreamingLlmOptions,
): Promise<StreamingLlmResult> {
  const callId = options.callId || 'unknown';
  const startedAt = Date.now();

  try {
    if (options.abortSignal?.aborted) {
      return { ok: false, reason: 'cancelled' };
    }

    const client = getStreamingLlmClient();

    if (!client) {
      logger.warn(`[${callId}] ${options.operation}_skipped`, {
        reason: 'litellm_credentials_missing',
      });

      return {
        ok: false,
        reason: 'litellm_credentials_missing',
      };
    }

    logger.info(`[${callId}] ${options.operation}_started`, {
      input_length: options.userPrompt.length,
      has_system_prompt: Boolean(options.systemPrompt),
    });

    const streamResult = await client.generateStream({
      systemPrompt: options.systemPrompt,
      messages: [createUserMessage(options.userPrompt)],
      abortSignal: options.abortSignal,
    });

    try {
      for await (const chunk of streamResult.stream) {
        if (chunk.type === 'error') {
          throw new Error(
            chunk.error || 'LLM stream returned an error chunk',
          );
        }
      }
    } catch (error) {
      // Prevent an unhandled rejection when stream accumulation fails.
      await streamResult.finalMessage.catch(() => undefined);
      throw error;
    }

    const finalMessage = await streamResult.finalMessage;
    const content = finalMessage.content.trim();

    if (!content) {
      logger.warn(`[${callId}] ${options.operation}_failed`, {
        reason: 'empty_content',
        duration_ms: Date.now() - startedAt,
      });

      return {
        ok: false,
        reason: 'empty_content',
      };
    }

    logger.info(`[${callId}] ${options.operation}_success`, {
      duration_ms: Date.now() - startedAt,
    });

    return {
      ok: true,
      content,
    };
  } catch (error) {
    const reason = options.abortSignal?.aborted
      ? 'cancelled'
      : 'exception';

    const message =
      error instanceof Error ? error.message : String(error);

    logger.error(`[${callId}] ${options.operation}_failed`, {
      reason,
      error: message,
      duration_ms: Date.now() - startedAt,
    });

    return {
      ok: false,
      reason,
      error: message,
    };
  }
}
