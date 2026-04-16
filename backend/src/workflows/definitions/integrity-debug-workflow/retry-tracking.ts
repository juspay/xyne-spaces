/**
 * Retry tracking utilities for workflow steps
 * Stores retry attempt metadata in workflow steps for observability
 */

export interface RetryAttempt {
  attemptNumber: number;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'success' | 'failed';
  error?: string;
  errorStack?: string;
  durationMs?: number;
}

export interface RetryMetadata {
  totalAttempts: number;
  maxRetries: number;
  finalStatus: 'success' | 'failed' | 'running';
  attempts: RetryAttempt[];
  config: {
    retryDelayMs: number;
    exponentialBackoff: boolean;
  };
}

/**
 * Create initial retry metadata
 */
export function createRetryMetadata(maxRetries: number, retryDelayMs: number, exponentialBackoff: boolean): RetryMetadata {
  return {
    totalAttempts: 0,
    maxRetries,
    finalStatus: 'running',
    attempts: [],
    config: {
      retryDelayMs,
      exponentialBackoff,
    },
  };
}

/**
 * Add attempt to retry metadata
 */
export function addAttempt(
  metadata: RetryMetadata,
  attemptNumber: number,
  status: 'running' | 'success' | 'failed',
  error?: Error
): RetryMetadata {
  const startedAt = new Date().toISOString();

  const attempt: RetryAttempt = {
    attemptNumber,
    startedAt,
    status,
  };

  if (error) {
    attempt.error = error.message;
    attempt.errorStack = error.stack;
  }

  return {
    ...metadata,
    totalAttempts: Math.max(metadata.totalAttempts, attemptNumber),
    attempts: [...metadata.attempts, attempt],
  };
}

/**
 * Update attempt status
 */
export function updateAttempt(
  metadata: RetryMetadata,
  attemptNumber: number,
  status: 'success' | 'failed',
  error?: Error
): RetryMetadata {
  const completedAt = new Date().toISOString();

  const attempts = metadata.attempts.map((attempt) => {
    if (attempt.attemptNumber === attemptNumber) {
      const startTime = new Date(attempt.startedAt).getTime();
      const endTime = new Date(completedAt).getTime();

      return {
        ...attempt,
        completedAt,
        status,
        durationMs: endTime - startTime,
        ...(error ? {
          error: error.message,
          errorStack: error.stack,
        } : {}),
      };
    }
    return attempt;
  });

  // Update final status
  let finalStatus: 'success' | 'failed' | 'running' = 'running';
  if (status === 'success') {
    finalStatus = 'success';
  } else if (status === 'failed' && attemptNumber >= metadata.maxRetries + 1) {
    finalStatus = 'failed';
  }

  return {
    ...metadata,
    attempts,
    finalStatus,
  };
}

/**
 * Format retry metadata for display
 */
export function formatRetryMetadata(metadata: RetryMetadata): string {
  const lines = [
    `Retry Summary: ${metadata.finalStatus.toUpperCase()}`,
    `Total Attempts: ${metadata.totalAttempts}/${metadata.maxRetries + 1}`,
    ``,
  ];

  metadata.attempts.forEach((attempt) => {
    const status = attempt.status === 'success' ? '✅' : attempt.status === 'failed' ? '❌' : '🔄';
    const duration = attempt.durationMs ? ` (${(attempt.durationMs / 1000).toFixed(2)}s)` : '';

    lines.push(`${status} Attempt ${attempt.attemptNumber}${duration}`);

    if (attempt.error) {
      lines.push(`   Error: ${attempt.error}`);
    }

    if (attempt.status === 'running') {
      lines.push(`   Started: ${attempt.startedAt}`);
    } else if (attempt.completedAt) {
      lines.push(`   Completed: ${attempt.completedAt}`);
    }

    lines.push('');
  });

  return lines.join('\n');
}