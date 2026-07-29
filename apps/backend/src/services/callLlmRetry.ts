import { Agent, createUserMessage } from '@framework';
import { extractAgentContent } from '@/utils/agentUtils';
import { logger } from '@/utils/logger';

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 120_000; // 2 minutes
const MAX_DELAY_MS = 960_000; // 16 minutes

type ExtractedContent = ReturnType<typeof extractAgentContent>;

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
): Promise<void> {
  const delay = getRetryDelayMs(attempt);

  logger.info(`[${callId}] ${operation}_retry_delay`, {
    attempt,
    delay_ms: delay,
  });

  await sleep(delay);
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