/**
 * Retry utility for integrity debug workflow steps
 * Provides configurable retry logic with exponential backoff
 */

import { logger } from '../../../utils/logger.js';
import {
  RetryMetadata,
  createRetryMetadata,
  addAttempt,
  updateAttempt,
  formatRetryMetadata
} from './retry-tracking.js';

export interface RetryConfig {
  maxRetries: number;
  retryDelayMs?: number;
  exponentialBackoff?: boolean;
  onRetryUpdate?: (metadata: RetryMetadata) => Promise<void>;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  errors: Array<{
    attempt: number;
    error: string;
    timestamp: string;
  }>;
  retryMetadata?: RetryMetadata;
}

/**
 * Execute a function with retry logic
 * @param stepName - Name of the step for logging
 * @param fn - Function to execute
 * @param config - Retry configuration
 * @returns RetryResult with success status, result, and retry details
 */
export async function executeWithRetry<T>(
  stepName: string,
  fn: () => Promise<T>,
  config: RetryConfig
): Promise<RetryResult<T>> {
  const { maxRetries, retryDelayMs = 1000, exponentialBackoff = true, onRetryUpdate } = config;
  const errors: Array<{ attempt: number; error: string; timestamp: string }> = [];

  // Initialize retry metadata
  let retryMetadata = createRetryMetadata(maxRetries, retryDelayMs, exponentialBackoff);

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      // Mark attempt as running
      retryMetadata = addAttempt(retryMetadata, attempt, 'running');
      if (onRetryUpdate) {
        await onRetryUpdate(retryMetadata);
      }

      logger.info(`[${stepName}] 🔄 Attempt ${attempt}/${maxRetries + 1}${attempt > 1 ? ' (RETRY)' : ''}`);
      const result = await fn();

      // Mark attempt as success
      retryMetadata = updateAttempt(retryMetadata, attempt, 'success');
      if (onRetryUpdate) {
        await onRetryUpdate(retryMetadata);
      }

      if (attempt > 1) {
        logger.info(`[${stepName}] ✅ SUCCEEDED on retry attempt ${attempt} after ${attempt - 1} failures`);
      }

      return {
        success: true,
        result,
        attempts: attempt,
        errors,
        retryMetadata,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorLog = {
        attempt,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      };

      errors.push(errorLog);

      // Mark attempt as failed
      retryMetadata = updateAttempt(retryMetadata, attempt, 'failed', error instanceof Error ? error : new Error(errorMessage));
      if (onRetryUpdate) {
        await onRetryUpdate(retryMetadata);
      }

      logger.error(`[${stepName}] ❌ Attempt ${attempt}/${maxRetries + 1} FAILED: ${errorMessage}`);

      // If this was the last attempt, don't retry
      if (attempt > maxRetries) {
        logger.error(`[${stepName}] 💀 ALL ${maxRetries + 1} ATTEMPTS FAILED - giving up`);
        logger.info(`[${stepName}] Retry Summary:\n${formatRetryMetadata(retryMetadata)}`);
        return {
          success: false,
          error: error instanceof Error ? error : new Error(errorMessage),
          attempts: attempt,
          errors,
          retryMetadata,
        };
      }

      // Calculate delay before next retry
      const delay = exponentialBackoff
        ? retryDelayMs * Math.pow(2, attempt - 1)
        : retryDelayMs;

      logger.info(`[${stepName}] ⏳ Waiting ${delay}ms before retry... (${maxRetries - attempt + 1} retries remaining)`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // Should never reach here, but TypeScript needs it
  throw new Error('Unexpected retry loop exit');
}

/**
 * Format retry errors for workflow output
 */
export function formatRetryErrors(
  stepName: string,
  retryResult: RetryResult<unknown>
): string {
  if (retryResult.success || retryResult.errors.length === 0) {
    return '';
  }

  const errorSummary = retryResult.errors.map((e) =>
    `  Attempt ${e.attempt} (${e.timestamp}): ${e.error}`
  ).join('\n');

  return `${stepName} failed after ${retryResult.attempts} attempts:\n${errorSummary}`;
}