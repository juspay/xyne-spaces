import {
  resolveWikiRevisionSources,
  wikiVersionIdentityHash,
} from '../../../src/sdlc/wiki/wikiRevisionPolicy';

describe('Wiki revision identity and source history', () => {
  it('uses commit, revision kind, and content instead of model session identity', () => {
    const input = { markdown: '# Payments', revisionKind: 'updated', commitSha: 'a'.repeat(40) };
    expect(wikiVersionIdentityHash(input)).toBe(wikiVersionIdentityHash({ ...input }));
    expect(wikiVersionIdentityHash({ ...input, revisionKind: 'refined' })).not.toBe(
      wikiVersionIdentityHash(input)
    );
    expect(wikiVersionIdentityHash({ ...input, commitSha: 'b'.repeat(40) })).not.toBe(
      wikiVersionIdentityHash(input)
    );
  });

  it('removes active mappings but preserves source history when a topic is archived', () => {
    expect(
      resolveWikiRevisionSources({
        action: 'archive',
        requestedSourcePaths: [],
        currentSourcePaths: ['src/legacy.ts', 'src/shared.ts'],
        archivedSourcePaths: null,
      })
    ).toEqual({
      activeSourcePaths: [],
      evidenceSourcePaths: ['src/legacy.ts', 'src/shared.ts'],
    });
  });

  it('repairs an archive retry without losing its previously captured sources', () => {
    expect(
      resolveWikiRevisionSources({
        action: 'archive',
        requestedSourcePaths: [],
        currentSourcePaths: [],
        archivedSourcePaths: ['src/legacy.ts'],
      })
    ).toEqual({ activeSourcePaths: [], evidenceSourcePaths: ['src/legacy.ts'] });
  });

  it('restores only verified current sources as the active mapping', () => {
    expect(
      resolveWikiRevisionSources({
        action: 'restore',
        requestedSourcePaths: ['src/replacement.ts'],
        currentSourcePaths: [],
        archivedSourcePaths: ['src/legacy.ts'],
      })
    ).toEqual({
      activeSourcePaths: ['src/replacement.ts'],
      evidenceSourcePaths: ['src/replacement.ts'],
    });
  });
});
