jest.mock('../../../src/database/client', () => ({
  DatabaseClient: { getInstance: jest.fn() },
}));
jest.mock('../../../src/config/env', () => ({
  config: { env: 'test', logging: { level: 'error' } },
}));

import {
  normalizeWikiRelativePath,
  normalizeWikiSourcePath,
  wikiFolderName,
} from '../../../src/sdlc/wiki/wikiPaths';
import { SdlcWikiService } from '../../../src/sdlc/wiki/SdlcWikiService';

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

  it.each(['/overview.md', '../overview.md', 'wiki\\overview.md', 'wiki/overview.txt'])(
    'rejects unsafe generated Wiki path %s',
    (sourcePath) => {
      expect(() => normalizeWikiRelativePath(sourcePath)).toThrow();
    }
  );
});

describe('SdlcWikiService repair preview', () => {
  it('is read-only and explains Canvas, version, and source preservation', async () => {
    const prisma = {
      repo: { findFirst: jest.fn().mockResolvedValue({ channelId: 'channel-1' }) },
      canvasFolder: { findMany: jest.fn().mockResolvedValue([{
        name: 'Wiki/scratch',
        canvases: [{
          id: 'canvas-1',
          title: 'Scratch',
          metadata: {
            surface: 'SDLC', repoId: 'repo-1', documentKind: 'WIKI',
            wikiRelativePath: 'scratch/test.md',
          },
          updatedAt: new Date('2026-08-12T00:00:00.000Z'),
        }],
      }]) },
    };
    const service = new SdlcWikiService(prisma as never);

    await expect(service.repairPreview(
      { userId: 'user-1', workspaceId: 'workspace-1' },
      'repo-1'
    )).resolves.toEqual([expect.objectContaining({
      path: 'scratch/test.md',
      action: 'archive',
      canvasId: 'canvas-1',
      preservesCanvasIdentity: true,
      preservesVersionHistory: true,
      preservesSourceEvidence: true,
      applied: false,
    })]);
    expect(prisma.canvasFolder.findMany).toHaveBeenCalledTimes(1);
  });
});
