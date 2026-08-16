import {
  githubSdlcSourceUrl,
  resolveSdlcSourceReferenceTokens,
} from '../../src/sdlc/sdlcSourceReferences';

describe('shared SDLC source references', () => {
  it('renders the same immutable file link format for non-Wiki artifacts', () => {
    const commitSha = 'a'.repeat(40);
    expect(
      resolveSdlcSourceReferenceTokens({
        markdown: 'Entry point: [[source:0]]',
        repositoryUrl: 'https://github.com/acme/repo.git',
        commitSha,
        references: [{ path: 'apps/backend/src/app.ts', symbol: 'App', startLine: 10 }],
      })
    ).toBe(
      `Entry point: [apps/backend/src/app.ts — App](https://github.com/acme/repo/blob/${commitSha}/apps/backend/src/app.ts#L10)`
    );
  });

  it('rejects model-built hosts, unsafe paths, and unknown tokens', () => {
    expect(() =>
      githubSdlcSourceUrl({
        repositoryUrl: 'https://evil.example/acme/repo',
        reference: { path: 'src/app.ts', commitSha: 'a'.repeat(40) },
      })
    ).toThrow('GitHub');
    expect(() =>
      resolveSdlcSourceReferenceTokens({
        markdown: 'Bad [[source:1]]',
        repositoryUrl: 'https://github.com/acme/repo',
        commitSha: 'a'.repeat(40),
        references: [{ path: 'src/app.ts' }],
      })
    ).toThrow('Valid zero-based indices: 0-0');
    expect(() =>
      resolveSdlcSourceReferenceTokens({
        markdown:
          'Bad [src/app.ts](https://github.com/acme/repo/blob/main/src/app.ts)',
        repositoryUrl: 'https://github.com/acme/repo',
        commitSha: 'a'.repeat(40),
        references: [],
      })
    ).toThrow('use [[source:N]] tokens');
    expect(() =>
      resolveSdlcSourceReferenceTokens({
        markdown: 'Bad [[source:x]]',
        repositoryUrl: 'https://github.com/acme/repo',
        commitSha: 'a'.repeat(40),
        references: [{ path: 'src/app.ts' }],
      })
    ).toThrow('zero-based integer index');
  });
});
