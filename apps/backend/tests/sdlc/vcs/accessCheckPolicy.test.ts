import { classifyRuntimeAccessFailure } from '../../../src/sdlc/vcs/accessCheckPolicy';

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
