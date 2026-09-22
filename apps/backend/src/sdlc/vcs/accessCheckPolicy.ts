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
