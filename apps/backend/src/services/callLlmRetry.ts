import { Agent, LLMClient, createUserMessage } from '@framework';
import { config } from '@/config/env';
import { extractAgentContent } from '@/utils/agentUtils';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { orgLLMCredentialService } from '@/services/orgLLMCredentialService';
import { OrgLLMServiceAccountPurpose } from '@xyne/shared';

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 120_000; // 2 minutes
const MAX_DELAY_MS = 960_000; // 16 minutes
const DEFAULT_MODEL = 'glm-latest';
// The non-streaming agent path for the same workload uses a 300s request
// timeout. Long transcripts producing multi-phase markdown responses can
// exceed the 120s LLM_REQUEST_TIMEOUT_MS default, so the streaming client
// matches the agent path rather than the global default.
const STREAMING_REQUEST_TIMEOUT_MS = 300_000; // 5 minutes

type ExtractedContent = ReturnType<typeof extractAgentContent>;

export type StreamingLlmFailureReason =
  | 'cancelled'
  | 'empty_content'
  | 'litellm_credentials_missing'
  | 'exception';

export type StreamingLlmResult =
  | { ok: true; content: string }
  | { ok: false; reason: StreamingLlmFailureReason; error?: string };

// Per-user recording-summary model tier. 'fast' (default) uses
// config.llm.callRecordingFastLitellmModel; 'thinking' uses callRecordingThinkingLitellmModel.
export type SummaryModelType = 'fast' | 'thinking';

/** Resolve the litellm model name for a summary model tier. */
export function resolveSummaryModel(modelType: SummaryModelType | undefined): string {
  return modelType === 'thinking'
    ? config.llm.callRecordingThinkingLitellmModel || DEFAULT_MODEL
    : config.llm.callRecordingFastLitellmModel || DEFAULT_MODEL;
}

export interface ExecuteStreamingLlmOptions {
  userPrompt: string;
  systemPrompt?: string;
  operation: string;
  callId?: string;
  abortSignal?: AbortSignal;
  /**
   * Which model tier to use for this request: 'fast' (default) or 'thinking'.
   * Overrides the streaming client's default model per request.
   */
  modelType?: SummaryModelType;
  /**
   * Invoked as content deltas arrive, with the full text accumulated so far.
   * Lets a caller render partial output live (e.g. stream into a canvas).
   * Errors thrown here are swallowed so they never interrupt generation;
   * throttling is the caller's responsibility.
   */
  onDelta?: (accumulatedContent: string) => void | Promise<void>;
}

interface StreamingLlmCreds {
  apiKey: string;
  baseUrl: string;
  model: string;
}

// Clients are keyed by the resolved credential tuple so that orgs with their
// own provisioned LiteLLM keys each get an isolated client (and cache entry),
// while callers without org provisioning share the env-configured one.
const streamingLlmClients = new Map<string, LLMClient>();

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

const getRetryDelayMs = (attempt: number): number =>
  Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);

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
  abortSignal?: AbortSignal,
): Promise<void> {
  const delay = getRetryDelayMs(attempt);

  logger.info(`[${callId}] ${operation}_retry_delay`, {
    attempt,
    delay_ms: delay,
  });

  if (!abortSignal) {
    await sleep(delay);
    return;
  }

  if (abortSignal.aborted) {
    return;
  }

  // Resolve as soon as the delay elapses OR the request is aborted, whichever
  // comes first, so a cancelled call doesn't sit through the full backoff (up
  // to MAX_DELAY_MS) before the loop notices the abort.
  await new Promise<void>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      abortSignal.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    abortSignal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function executeCallLlmWithRetry(
  createAgent: () => Agent | null | Promise<Agent | null>,
  buildPrompt: () => string,
  operation: string,
  callId: string,
  buildSystemPrompt?: () => string | undefined,
): Promise<ExtractedContent> {
  const logCallId = callId || 'unknown';
  const totalStart = Date.now();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptStart = Date.now();
    const isLastAttempt = attempt === MAX_ATTEMPTS;

    logger.info(`[${logCallId}] ${operation}_attempt ${attempt}/${MAX_ATTEMPTS}`);

    try {
      const agent = await createAgent();

      if (!agent) {
        logger.error(`[${logCallId}] ${operation}_failed`, {
          reason: 'agent_creation_failed',
          attempt,
        });

        return failedResult('agent_creation_failed');
      }

      const systemPrompt = buildSystemPrompt?.()?.trim();
      const result = await agent.execute({
        messages: [createUserMessage(buildPrompt())],
        ...(systemPrompt ? { systemPrompt } : {}),
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
 * Resolves the LiteLLM credentials for a streaming request. Delegates all
 * DB / DEFAULT-purpose / env fallback logic to orgLLMCredentialService.
 * Returns null when no credential is available (service's env fallback
 * also empty).
 */
async function resolveStreamingLlmCreds(callId?: string): Promise<StreamingLlmCreds | null> {
  let userId: string | null = null;

  if (callId) {
    try {
      userId =
        (await repositories.calls.findByExternalId(callId))?.createdByUserId ?? null;
    } catch (error) {
      logger.warn(`[${callId}] call lookup failed for org credential resolution`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const credential = await orgLLMCredentialService.getCredentialByUserId(
    userId,
    OrgLLMServiceAccountPurpose.CALL_TRANSCRIPT,
  );

  if (!credential?.apiKey || !credential.baseUrl) {
    return null;
  }

  return {
    apiKey: credential.apiKey,
    baseUrl: credential.baseUrl,
    model: credential.defaultModel || config.llm.callLitellmModel || DEFAULT_MODEL,
  };
}

/**
 * Returns a cached LLMClient for the given resolved credentials; callers must
 * resolve credentials first via resolveStreamingLlmCreds.
 */
function getStreamingLlmClient(creds: StreamingLlmCreds): LLMClient {
  const cacheKey = `${creds.apiKey}\n${creds.baseUrl}\n${creds.model}`;

  let client = streamingLlmClients.get(cacheKey);
  if (!client) {
    client = new LLMClient({
      provider: {
        type: 'litellm',
        config: {
          apiKey: creds.apiKey,
          baseUrl: creds.baseUrl,
          timeout: STREAMING_REQUEST_TIMEOUT_MS,
        },
      },
      defaultModel: creds.model,
      retry: {
        maxAttempts: MAX_ATTEMPTS,
        baseDelay: BASE_DELAY_MS,
        maxDelay: MAX_DELAY_MS,
        exponentialBackoff: true,
      },
    });
    streamingLlmClients.set(cacheKey, client);
  }

  return client;
}

/**
 * Requests a streaming completion through the shared framework client,
 * fully drains the stream, and returns the accumulated final message.
 * The full drain is required: the framework only resolves `finalMessage`
 * once the consumer has iterated the stream to completion.
 */
export async function executeStreamingLlmRequest(
  options: ExecuteStreamingLlmOptions,
): Promise<StreamingLlmResult> {
  const callId = options.callId || 'unknown';
  const totalStart = Date.now();

  if (options.abortSignal?.aborted) {
    return { ok: false, reason: 'cancelled' };
  }

  const creds = await resolveStreamingLlmCreds(options.callId);

  if (!creds) {
    logger.warn(`[${callId}] ${options.operation}_skipped`, {
      reason: 'litellm_credentials_missing',
    });

    return {
      ok: false,
      reason: 'litellm_credentials_missing',
    };
  }

  const client = getStreamingLlmClient(creds);

  // The framework's client-level retry is a no-op for streaming: it retries the
  // synchronous call that constructs the async generator, which always
  // "succeeds" before any network work happens. The real request runs while the
  // stream below is drained, so retries have to live here — mirroring
  // executeCallLlmWithRetry. Only transient exceptions are retried; cancelled,
  // empty_content, and missing credentials are terminal.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptStart = Date.now();
    const isLastAttempt = attempt === MAX_ATTEMPTS;
    if (options.abortSignal?.aborted) {
      return { ok: false, reason: 'cancelled' };
    }

    logger.info(`[${callId}] ${options.operation}_attempt ${attempt}/${MAX_ATTEMPTS}`, {
      input_length: options.userPrompt.length,
      has_system_prompt: Boolean(options.systemPrompt),
    });

    try {
      const streamResult = await client.generateStream({
        systemPrompt: options.systemPrompt,
        messages: [createUserMessage(options.userPrompt)],
        // Override the cached client's default model per request so 'fast' and
        // 'thinking' both resolve explicitly (never leak the wrong default).
        model: resolveSummaryModel(options.modelType),
        abortSignal: options.abortSignal,
      });

      try {
        let accumulated = '';
        for await (const chunk of streamResult.stream) {
          if (chunk.type === 'error') {
            throw new Error(chunk.error || 'LLM stream returned an error chunk');
          }
          if (options.onDelta && chunk.type === 'content' && chunk.content) {
            accumulated += chunk.content;
            try {
              await options.onDelta(accumulated);
            } catch (deltaError) {
              // A consumer-side render failure must not abort generation.
              logger.warn(`[${callId}] ${options.operation}_on_delta_failed`, {
                error: deltaError instanceof Error ? deltaError.message : String(deltaError),
              });
            }
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
        // Deterministic empty response — retrying only burns the backoff budget.
        logger.warn(`[${callId}] ${options.operation}_failed`, {
          reason: 'empty_content',
          attempt,
          duration_ms: Date.now() - attemptStart,
        });

        return {
          ok: false,
          reason: 'empty_content',
        };
      }

      logger.info(`[${callId}] ${options.operation}_success`, {
        attempts_used: attempt,
        duration_ms: Date.now() - attemptStart,
        total_duration_ms: Date.now() - totalStart,
      });

      return {
        ok: true,
        content,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Cancellation is terminal; do not consume retries on an aborted request.
      if (options.abortSignal?.aborted) {
        return {
          ok: false,
          reason: 'cancelled',
          error: message,
        };
      }

      logger.warn(`[${callId}] ${options.operation}_attempt_threw`, {
        attempt,
        max_attempts: MAX_ATTEMPTS,
        ...getErrorDetails(error),
        duration_ms: Date.now() - attemptStart,
      });

      if (isLastAttempt) {
        logger.error(`[${callId}] ${options.operation}_failed_after_retries`, {
          attempts: MAX_ATTEMPTS,
          ...getErrorDetails(error),
          total_duration_ms: Date.now() - totalStart,
        });

        return {
          ok: false,
          reason: 'exception',
          error: message,
        };
      }
    }

    await waitBeforeRetry(callId, options.operation, attempt, options.abortSignal);
  }

  // Unreachable: the final attempt always returns above.
  return { ok: false, reason: 'exception' };
}
