export interface RepositoryAccessState {
  status: string;
  errorCode?: string | null;
  startedAt?: Date | null;
  credentialRevision?: number | null;
}

export interface CredentialAccessState {
  status: string;
  validationStatus: string;
  revision: number;
}

const AUTOMATIC_RETRY_ERROR_CODES = new Set([
  'ACCESS_CHECK_QUEUE_UNAVAILABLE',
  'GITHUB_UNAVAILABLE',
  'INVALID_REPOSITORY_URL',
  'CREDENTIAL_INVALID_PUBLIC_FALLBACK',
]);

export function shouldEnsureRepositoryAccess(input: {
  repository: RepositoryAccessState;
  credential?: CredentialAccessState | null;
  force?: boolean;
  now?: Date;
  runningLeaseMs?: number;
}): boolean {
  if (input.force) return true;
  const { repository, credential } = input;
  const now = input.now ?? new Date();
  const runningLeaseMs = input.runningLeaseMs ?? 5 * 60_000;

  if (['QUEUED', 'CHECKING'].includes(repository.status)) {
    return (
      !repository.startedAt || now.getTime() - repository.startedAt.getTime() >= runningLeaseMs
    );
  }
  if (repository.status === 'NOT_CHECKED') return true;
  if (AUTOMATIC_RETRY_ERROR_CODES.has(repository.errorCode ?? '')) return true;
  if (repository.status !== 'STALE') return false;
  if (repository.errorCode === 'GITHUB_CREDENTIAL_INVALID') return true;
  if (!credential) return repository.errorCode === 'CREDENTIAL_DISCONNECTED';
  if (repository.credentialRevision !== credential.revision) return true;
  return (
    credential.validationStatus === 'VALID' || repository.errorCode === 'CREDENTIAL_DISCONNECTED'
  );
}

export type RuntimeAccessFailureKind = 'CREDENTIAL_INVALID' | 'PERMISSION_DENIED';

export function classifyRuntimeAccessFailure(error: string): RuntimeAccessFailureKind | null {
  if (
    /(?:\b401\b|authentication failed|could not read username|invalid credential|bad credentials|token (?:expired|revoked)|expired token|revoked token)/i.test(
      error
    )
  ) {
    return 'CREDENTIAL_INVALID';
  }
  if (
    /(?:\b403\b|permission denied|write access.*not granted|insufficient permission)/i.test(error)
  ) {
    return 'PERMISSION_DENIED';
  }
  return null;
}
