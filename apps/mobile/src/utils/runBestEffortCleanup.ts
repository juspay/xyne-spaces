export type CleanupStep = {
  stage: string;
  run: () => void | Promise<void>;
};

export type CleanupStageStatus = 'completed' | 'failed' | 'timed_out' | 'skipped';

export type CleanupStageResult = {
  stage: string;
  status: CleanupStageStatus;
};

export type AuthCleanupSummary = {
  localInvalidationCompleted: boolean;
  localDeletionAttempted: boolean;
  localDeletionConfirmed: boolean;
  remoteRevocationConfirmed: boolean;
  failedOrTimedOut: boolean;
  stages: CleanupStageResult[];
};

const LOCAL_INVALIDATION_STAGES = new Set([
  'mark_protected_auth_token_signed_out',
  'mark_protected_auth_token_signed_out_before_remote_logout',
]);

const LOCAL_DELETION_STAGES = new Set([
  'delete_mmkv_user_id',
  'delete_mmkv_user_cache',
  'delete_protected_auth_token',
  'delete_protected_auth_token_before_remote_logout',
  'clear_global_auth_token',
  'clear_global_auth_token_before_remote_logout',
  'clear_global_user_context',
  'clear_global_user_context_before_remote_logout',
  'clear_shared_auth_identity_before_remote_logout',
  'clear_in_memory_auth',
  'drop_user_databases',
]);

function isTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timed out/i.test(message);
}

export async function runBestEffortCleanup(
  steps: readonly CleanupStep[],
  onError: (stage: string, error: unknown) => void,
  shouldRun: () => boolean = () => true,
): Promise<CleanupStageResult[]> {
  const results: CleanupStageResult[] = [];
  let abortRemaining = false;

  for (const step of steps) {
    if (abortRemaining || !shouldRun()) {
      abortRemaining = true;
      results.push({ stage: step.stage, status: 'skipped' });
      continue;
    }

    try {
      await step.run();
      results.push({ stage: step.stage, status: 'completed' });
    } catch (error) {
      results.push({
        stage: step.stage,
        status: isTimeoutError(error) ? 'timed_out' : 'failed',
      });
      try {
        onError(step.stage, error);
      } catch {
        // Reporting must never prevent later security cleanup stages.
      }
    }
  }

  return results;
}

export function summarizeAuthCleanup(
  stages: readonly CleanupStageResult[],
  options: {
    remoteRevocationConfirmed: boolean;
    remoteRevocationAttempted?: boolean;
  },
): AuthCleanupSummary {
  const invalidation = stages.filter(stage => LOCAL_INVALIDATION_STAGES.has(stage.stage));
  const deletion = stages.filter(stage => LOCAL_DELETION_STAGES.has(stage.stage));
  const remoteRevocationAttempted = options.remoteRevocationAttempted ?? false;
  const failedOrTimedOut =
    stages.some(stage => stage.status === 'failed' || stage.status === 'timed_out') ||
    (remoteRevocationAttempted && !options.remoteRevocationConfirmed);

  return {
    localInvalidationCompleted:
      invalidation.length > 0 && invalidation.every(stage => stage.status === 'completed'),
    localDeletionAttempted: deletion.some(stage => stage.status !== 'skipped'),
    localDeletionConfirmed:
      deletion.length > 0 && deletion.every(stage => stage.status === 'completed'),
    remoteRevocationConfirmed: options.remoteRevocationConfirmed,
    failedOrTimedOut,
    stages: [...stages],
  };
}
