jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn() } }));

import { AppError } from '@/middleware/errorHandler';
import {
  isSafeSdlcGitRef,
  requireSdlcBaseBranch,
  toSdlcGithubCloneUrl,
} from '../../src/sdlc/sdlcRepositoryContext';

describe('SDLC repository context', () => {
  it('turns the scheme-less canonical identity into an HTTPS clone URL', () => {
    expect(toSdlcGithubCloneUrl('github.com/github-samples/pets-workshop')).toBe(
      'https://github.com/github-samples/pets-workshop.git'
    );
  });

  it('normalizes an already-qualified GitHub canonical value', () => {
    expect(toSdlcGithubCloneUrl('https://github.com/Owner/Repo.git')).toBe(
      'https://github.com/Owner/Repo.git'
    );
  });

  it.each([
    'gitlab.com/owner/repo',
    'github.com/owner/repo/subdir',
    'github.com/owner/repo?token=secret',
    'github.com/owner',
  ])('rejects unsupported repository identity %p', (value) => {
    expect(() => toSdlcGithubCloneUrl(value)).toThrow(AppError);
  });

  it('uses main when the stored branch list is empty', () => {
    expect(requireSdlcBaseBranch([])).toBe('main');
  });

  it.each(['main', 'feature/XYNE-123', 'release-1.2'])('accepts safe branch %p', (branch) => {
    expect(isSafeSdlcGitRef(branch)).toBe(true);
  });

  it.each(['', '../main', 'feature//bad', 'bad branch', 'main/'])(
    'rejects unsafe branch %p',
    (branch) => {
      expect(isSafeSdlcGitRef(branch)).toBe(false);
    }
  );
});
