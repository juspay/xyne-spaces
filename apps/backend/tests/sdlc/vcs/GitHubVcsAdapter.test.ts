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

describe('GitHubVcsAdapter anonymous read verification', () => {
  afterEach(() => jest.restoreAllMocks());

  it('verifies a public branch head without sending an Authorization header', async () => {
    const sha = 'a'.repeat(40);
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ object: { sha } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const adapter = new GitHubVcsAdapter();
    const repository = adapter.parseRepositoryUrl('https://github.com/example/public-repo');

    await expect(adapter.verifyRemoteCommit(undefined, repository, 'main', sha)).resolves.toBe(
      undefined
    );
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('identifies the exact missing Wiki source path', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
    const adapter = new GitHubVcsAdapter();
    const repository = adapter.parseRepositoryUrl('https://github.com/example/public-repo');

    await expect(
      adapter.verifyPathsAtCommit(undefined, repository, 'a'.repeat(40), [
        'src/missing.ts',
      ])
    ).rejects.toMatchObject({
      code: 'INVALID_SOURCE_PATH',
      message: expect.stringContaining('src/missing.ts'),
    });
  });

  it('validates citation line ranges against the file at the assigned commit', async () => {
    const content = Buffer.from('one\ntwo\nthree\n').toString('base64');
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ type: 'file', encoding: 'base64', content }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const adapter = new GitHubVcsAdapter();
    const repository = adapter.parseRepositoryUrl('https://github.com/example/public-repo');

    await expect(adapter.verifySourceRangesAtCommit(
      undefined,
      repository,
      'a'.repeat(40),
      [{ path: 'src/index.ts', startLine: 2, endLine: 3 }]
    )).resolves.toBeUndefined();
    await expect(adapter.verifySourceRangesAtCommit(
      undefined,
      repository,
      'a'.repeat(40),
      [{ path: 'src/index.ts', startLine: 20 }]
    )).rejects.toMatchObject({
      code: 'INVALID_SOURCE_RANGE',
      message: expect.stringContaining('has 4 lines'),
    });
  });
});

describe('GitHubVcsAdapter first-parent history', () => {
  it('returns the fetched branch first-parent chain oldest to newest', async () => {
    const root = '1'.repeat(40);
    const middle = '2'.repeat(40);
    const head = '3'.repeat(40);
    const runGit = jest.fn(async (args: string[], _options: { env: NodeJS.ProcessEnv }) => ({
      stdout: args.includes('rev-list') ? `${root}\n${middle}\n${head}\n` : '',
    }));
    const removeTempDirectory = jest.fn().mockResolvedValue(undefined);
    const adapter = new GitHubVcsAdapter({
      runGit,
      makeTempDirectory: jest.fn().mockResolvedValue('/tmp/wiki-history-test'),
      removeTempDirectory,
    });
    const repository = adapter.parseRepositoryUrl('https://github.com/example/public-repo');

    await expect(adapter.listFirstParentHistory(undefined, repository, 'main')).resolves.toEqual({
      targetHeadSha: head,
      commits: [
        { sha: root, parentSha: null },
        { sha: middle, parentSha: root },
        { sha: head, parentSha: middle },
      ],
    });
    expect(runGit).toHaveBeenCalledWith(
      expect.arrayContaining(['rev-list', '--first-parent', '--reverse']),
      expect.objectContaining({ env: expect.objectContaining({ GIT_TERMINAL_PROMPT: '0' }) })
    );
    expect(runGit.mock.calls[1]?.[0]).toEqual(expect.arrayContaining(['--filter=tree:0']));
    expect(removeTempDirectory).toHaveBeenCalledWith('/tmp/wiki-history-test');
  });

  it('parses more than seven thousand first-parent commits within the bounded buffer', async () => {
    const shas = Array.from({ length: 7_100 }, (_, index) =>
      (index + 1).toString(16).padStart(40, '0')
    );
    const runGit = jest.fn(async (args: string[], options: { maxBuffer: number }) => ({
      stdout: args.includes('rev-list') ? `${shas.join('\n')}\n` : '',
      maxBuffer: options.maxBuffer,
    }));
    const adapter = new GitHubVcsAdapter({
      runGit,
      makeTempDirectory: jest.fn().mockResolvedValue('/tmp/wiki-history-large-test'),
      removeTempDirectory: jest.fn().mockResolvedValue(undefined),
    });
    const repository = adapter.parseRepositoryUrl('https://github.com/example/large-repo');

    const history = await adapter.listFirstParentHistory(undefined, repository, 'main');

    expect(history.commits).toHaveLength(7_100);
    expect(history.commits[0]).toEqual({ sha: shas[0], parentSha: null });
    expect(history.commits[7_099]).toEqual({ sha: shas[7_099], parentSha: shas[7_098] });
    expect(runGit.mock.calls[2]?.[1]?.maxBuffer).toBeGreaterThan(300_000);
  });

  it('passes private credentials through Git config environment, never command arguments', async () => {
    const sha = 'a'.repeat(40);
    const runGit = jest.fn(async (args: string[], _options: { env: NodeJS.ProcessEnv }) => ({
      stdout: args.includes('rev-list') ? `${sha}\n` : '',
    }));
    const adapter = new GitHubVcsAdapter({
      runGit,
      makeTempDirectory: jest.fn().mockResolvedValue('/tmp/wiki-history-private-test'),
      removeTempDirectory: jest.fn().mockResolvedValue(undefined),
    });
    const repository = adapter.parseRepositoryUrl('https://github.com/example/private-repo');

    await adapter.listFirstParentHistory('secret-token', repository, 'release/v1');

    expect(runGit.mock.calls.flatMap(([args]) => args)).not.toContain('secret-token');
    expect(runGit.mock.calls[1]?.[1]?.env).toMatchObject({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    });
  });
});
