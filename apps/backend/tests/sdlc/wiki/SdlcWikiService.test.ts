import { normalizeWikiSourcePath, wikiFolderName } from '../../../src/sdlc/wiki/wikiPaths';

describe('SDLC Wiki source paths', () => {
  it('strips the source repository and maps its directory to a Wiki folder', () => {
    const relativePath = normalizeWikiSourcePath(
      'xyne-spaces',
      'xyne-spaces/features/chat-system.md'
    );

    expect(relativePath).toBe('features/chat-system.md');
    expect(wikiFolderName(relativePath)).toBe('Wiki/features');
  });

  it('keeps deeper hierarchy in the flat Canvas folder name', () => {
    const relativePath = normalizeWikiSourcePath(
      'xyne-spaces',
      'xyne-spaces/technical/workflows/engine.md'
    );

    expect(wikiFolderName(relativePath)).toBe('Wiki/technical/workflows');
  });

  it('maps root Markdown files to the Wiki root folder', () => {
    expect(wikiFolderName(normalizeWikiSourcePath('xyne-spaces', 'xyne-spaces/README.md'))).toBe(
      'Wiki'
    );
  });

  it.each([
    'another-repo/features/chat.md',
    'xyne-spaces/../secret.md',
    'xyne-spaces/features/chat.txt',
    'xyne-spaces\\features\\chat.md',
  ])('rejects unsafe or unsupported source path %s', (sourcePath) => {
    expect(() => normalizeWikiSourcePath('xyne-spaces', sourcePath)).toThrow();
  });
});
