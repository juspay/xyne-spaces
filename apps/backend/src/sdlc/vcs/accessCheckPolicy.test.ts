import { classifyRuntimeAccessFailure, shouldEnsureRepositoryAccess } from './accessCheckPolicy';

describe('repository access refresh policy', () => {
  const validCredential = { status: 'CONNECTED', validationStatus: 'VALID', revision: 2 };

  it('reuses durable ready evidence across page visits', () => {
    expect(
      shouldEnsureRepositoryAccess({
        repository: { status: 'READY', credentialRevision: 2 },
        credential: validCredential,
      })
    ).toBe(false);
  });

  it('automatically refreshes missing, revision-stale, and legacy fallback evidence', () => {
    expect(
      shouldEnsureRepositoryAccess({
        repository: { status: 'NOT_CHECKED' },
        credential: validCredential,
      })
    ).toBe(true);
    expect(
      shouldEnsureRepositoryAccess({
        repository: { status: 'STALE', credentialRevision: 1 },
        credential: validCredential,
      })
    ).toBe(true);
    expect(
      shouldEnsureRepositoryAccess({
        repository: {
          status: 'READY',
          errorCode: 'CREDENTIAL_INVALID_PUBLIC_FALLBACK',
          credentialRevision: 2,
        },
        credential: validCredential,
      })
    ).toBe(true);
  });

  it('does not loop while a current check is running', () => {
    const now = new Date('2026-08-05T08:00:00.000Z');
    expect(
      shouldEnsureRepositoryAccess({
        repository: { status: 'CHECKING', startedAt: now },
        credential: validCredential,
        now,
      })
    ).toBe(false);
  });

  it('recalculates anonymous access once after invalidation or disconnect', () => {
    expect(
      shouldEnsureRepositoryAccess({
        repository: {
          status: 'STALE',
          errorCode: 'GITHUB_CREDENTIAL_INVALID',
          credentialRevision: 2,
        },
        credential: { ...validCredential, validationStatus: 'INVALID' },
      })
    ).toBe(true);
    expect(
      shouldEnsureRepositoryAccess({
        repository: {
          status: 'BLOCKED',
          errorCode: 'GITHUB_CREDENTIAL_INVALID',
          credentialRevision: 2,
        },
        credential: { ...validCredential, validationStatus: 'INVALID' },
      })
    ).toBe(false);
  });
});

describe('runtime repository failure classification', () => {
  it('invalidates the credential only for authentication rejection', () => {
    expect(classifyRuntimeAccessFailure('401 Bad credentials')).toBe('CREDENTIAL_INVALID');
    expect(classifyRuntimeAccessFailure('token expired')).toBe('CREDENTIAL_INVALID');
  });

  it('keeps repository permission failures scoped to the repository', () => {
    expect(classifyRuntimeAccessFailure('403 write access is not granted')).toBe(
      'PERMISSION_DENIED'
    );
    expect(classifyRuntimeAccessFailure('network connection reset')).toBeNull();
  });
});
