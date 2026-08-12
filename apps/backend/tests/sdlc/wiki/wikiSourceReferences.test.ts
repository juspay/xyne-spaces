import {
  githubWikiSourceUrl,
  renderWikiSourceReference,
  resolveWikiSourceReferenceTokens,
} from '../../../src/sdlc/wiki/wikiSourceReferences';

describe('Wiki source references', () => {
  const reference = {
    path: 'src/auth/session.ts',
    commitSha: 'a'.repeat(40),
    symbol: 'createSession()',
    startLine: 42,
    endLine: 91,
  };

  it('builds a trusted canonical GitHub blob link with optional lines', () => {
    expect(
      githubWikiSourceUrl({ repositoryUrl: 'https://github.com/acme/repo.git', reference })
    ).toBe(`https://github.com/acme/repo/blob/${'a'.repeat(40)}/src/auth/session.ts#L42-L91`);
    expect(
      renderWikiSourceReference({ repositoryUrl: 'https://github.com/acme/repo', reference })
    ).toContain('[src/auth/session.ts — createSession()]');
  });

  it('replaces structured tokens without letting the agent construct URLs', () => {
    expect(
      resolveWikiSourceReferenceTokens({
        markdown: 'Sessions are persisted. [[source:0]]',
        repositoryUrl: 'https://github.com/acme/repo',
        commitSha: 'a'.repeat(40),
        references: [{ path: 'src/session.ts', symbol: 'persist()' }],
      })
    ).toContain(`https://github.com/acme/repo/blob/${'a'.repeat(40)}/src/session.ts`);
  });

  it('reports the valid zero-based range for an unknown citation token', () => {
    expect(() =>
      resolveWikiSourceReferenceTokens({
        markdown: 'Invalid citation. [[source:2]]',
        repositoryUrl: 'https://github.com/acme/repo',
        commitSha: 'a'.repeat(40),
        references: [{ path: 'src/session.ts' }, { path: 'src/token.ts' }],
      })
    ).toThrow('Valid zero-based indices: 0-1');
  });

  it('rejects arbitrary hosts and unsafe paths', () => {
    expect(() =>
      githubWikiSourceUrl({ repositoryUrl: 'https://evil.example/repo', reference })
    ).toThrow('GitHub');
    expect(() =>
      githubWikiSourceUrl({
        repositoryUrl: 'https://github.com/acme/repo',
        reference: { ...reference, path: '../secret' },
      })
    ).toThrow('Invalid Wiki source path');
    expect(() =>
      githubWikiSourceUrl({ repositoryUrl: 'https://github.com/acme/repo/extra', reference })
    ).toThrow('repository URL');
  });

  it('escapes untrusted symbol text in the Markdown label', () => {
    expect(
      renderWikiSourceReference({
        repositoryUrl: 'https://github.com/acme/repo',
        reference: { ...reference, symbol: 'x]([bad](https://evil.example)' },
      })
    ).not.toContain(']([bad]');
  });
});
