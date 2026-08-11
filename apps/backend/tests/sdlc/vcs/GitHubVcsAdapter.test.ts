import { GitHubVcsAdapter } from '../../../src/sdlc/vcs/GitHubVcsAdapter';

describe('GitHubVcsAdapter repository parsing', () => {
  const adapter = new GitHubVcsAdapter();

  it('accepts the scheme-less canonical URL stored by existing SDLC workspaces', () => {
    expect(adapter.parseRepositoryUrl('github.com/github-samples/pets-workshop')).toEqual({
      provider: 'GITHUB',
      owner: 'github-samples',
      name: 'pets-workshop',
      canonicalUrl: 'https://github.com/github-samples/pets-workshop',
      cloneUrl: 'https://github.com/github-samples/pets-workshop.git',
    });
  });
});

describe('GitHubVcsAdapter credential failures', () => {
  afterEach(() => jest.restoreAllMocks());

  it('classifies a 401 as an invalid or expired credential', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 401 }));

    await expect(
      new GitHubVcsAdapter().validateCredential('github_pat_invalid', 'xyne')
    ).rejects.toMatchObject({ code: 'GITHUB_CREDENTIAL_INVALID', httpStatus: 401 });
  });

  it('keeps repository permission failures distinct from credential invalidation', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 403 }));

    await expect(
      new GitHubVcsAdapter().validateCredential('github_pat_valid', 'xyne')
    ).rejects.toMatchObject({
      code: 'GITHUB_ORG_APPROVAL_OR_PERMISSION_REQUIRED',
      httpStatus: 403,
    });
  });
});
