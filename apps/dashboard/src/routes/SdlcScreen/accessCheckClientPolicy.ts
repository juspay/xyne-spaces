const RETRYABLE_ACCESS_ERRORS = new Set([
  'ACCESS_CHECK_QUEUE_UNAVAILABLE',
  'GITHUB_UNAVAILABLE',
  'INVALID_REPOSITORY_URL',
  'CREDENTIAL_INVALID_PUBLIC_FALLBACK',
]);

export function shouldRequestAutomaticAccessCheck(input: {
  status: string;
  errorCode?: string | null;
}): boolean {
  if (['QUEUED', 'CHECKING'].includes(input.status)) return false;
  if (input.status === 'NOT_CHECKED' || input.status === 'STALE') return true;
  return RETRYABLE_ACCESS_ERRORS.has(input.errorCode ?? '');
}
