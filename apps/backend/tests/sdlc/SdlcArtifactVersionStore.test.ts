jest.mock('../../src/database/client', () => ({
  DatabaseClient: { getInstance: jest.fn() },
}));
jest.mock('../../src/services/canvasService', () => ({
  convertBlockNoteToMarkdown: jest.fn(),
}));
jest.mock('../../src/config/env', () => ({
  config: { env: 'test', logging: { level: 'error' } },
}));

import { convertBlockNoteToMarkdown } from '../../src/services/canvasService';
import { SdlcArtifactVersionStore } from '../../src/sdlc/SdlcArtifactVersionStore';

const SHA = 'a'.repeat(40);

function repository() {
  return { id: 'repo-1', channelId: 'channel-1', projectId: 'project-1' };
}

function wikiCanvas(path = 'architecture/current.md') {
  return {
    id: 'canvas-1',
    title: 'Current architecture',
    metadata: {
      surface: 'SDLC',
      documentKind: 'WIKI',
      repoId: 'repo-1',
      wikiRelativePath: path,
      wikiSourcePaths: ['src/current.ts'],
      wikiLastCommitSha: SHA,
      wikiRevisionKind: 'updated',
      wikiContentHash: 'current-hash',
      wikiCanvasVersionId: 'version-new',
    },
  };
}

function version(id: string, createdAt: string) {
  return {
    id,
    name: id,
    content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }],
    contentHash: `${id}-stored-hash`,
    createdBy: 'user-1',
    createdAt: new Date(createdAt),
  };
}

function store(overrides: Record<string, unknown> = {}) {
  const prisma = {
    repo: { findFirst: jest.fn().mockResolvedValue(repository()) },
    canvas: {
      findMany: jest.fn().mockResolvedValue([wikiCanvas()]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    canvasVersion: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
    },
    sdlcEntityLink: { findMany: jest.fn().mockResolvedValue([]) },
    workflowExecution: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
  return { prisma, store: new SdlcArtifactVersionStore(prisma as never) };
}

const binding = {
  repoId: 'repo-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
};

describe('SdlcArtifactVersionStore', () => {
  it('lists canonical current artifacts and filters archived Wiki pages by default', async () => {
    const current = { ...wikiCanvas(), updatedAt: new Date('2026-08-13T12:00:00.000Z') };
    const archived = {
      ...wikiCanvas('archive/old.md'),
      id: 'canvas-2',
      updatedAt: new Date('2026-08-12T12:00:00.000Z'),
      metadata: { ...wikiCanvas('archive/old.md').metadata, wikiArchivedAt: '2026-08-12T12:00:00.000Z' },
    };
    const { prisma, store: subject } = store();
    prisma.canvas.findMany.mockResolvedValue([current, archived]);

    const result = await subject.listArtifacts(binding);

    expect(result).toEqual([expect.objectContaining({
      canvasId: 'canvas-1', artifactKind: 'WIKI', path: 'architecture/current.md', archived: false,
    })]);
  });

  it('reads canonical current artifact Markdown with a stable content hash', async () => {
    const { prisma, store: subject } = store();
    prisma.canvas.findUnique.mockResolvedValue({ content: [{ type: 'paragraph', content: [] }] });
    jest.mocked(convertBlockNoteToMarkdown).mockResolvedValue('# Current architecture');

    const result = await subject.readArtifact({
      ...binding,
      selector: { type: 'WIKI_PAGE', path: 'architecture/current.md' },
    });

    expect(result).toMatchObject({
      artifact: { canvasId: 'canvas-1', artifactKind: 'WIKI' },
      markdown: '# Current architecture',
    });
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('lists all Canvas versions newest first with bounded continuation and nullable manual provenance', async () => {
    const rows = [
      version('version-new', '2026-08-13T12:00:00.000Z'),
      version('version-manual', '2026-08-12T12:00:00.000Z'),
      version('version-old', '2026-08-11T12:00:00.000Z'),
    ];
    const { prisma, store: subject } = store();
    prisma.canvasVersion.findMany.mockResolvedValue(rows);

    const result = await subject.listVersions({
      ...binding,
      selector: { type: 'WIKI_PAGE', path: 'architecture/current.md' },
      limit: 2,
    });

    expect(prisma.canvasVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { canvasId: 'canvas-1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 3,
    }));
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('version-manual');
    expect(result.versions.map(item => item.versionId)).toEqual(['version-new', 'version-manual']);
    expect(result.versions[1]).toMatchObject({
      origin: 'CANVAS',
      checkpointRef: null,
      action: null,
      metadataStatus: 'unavailable',
      sourceEvidence: null,
    });
  });

  it('joins finalized moved-page evidence while resolving history from the current path', async () => {
    const { prisma, store: subject } = store();
    prisma.canvasVersion.findMany.mockResolvedValue([
      version('version-move', '2026-08-13T12:00:00.000Z'),
    ]);
    prisma.sdlcEntityLink.findMany.mockResolvedValue([{ targetId: 'execution-1' }]);
    prisma.workflowExecution.findMany.mockResolvedValue([{
      context: null,
      output: JSON.stringify({
        version: 1,
        outcomes: [{
          commitSha: SHA,
          status: 'updated',
          completedAt: '2026-08-13T12:00:00.000Z',
          revisions: [{
            action: 'moved',
            commitSha: SHA,
            canvasId: 'canvas-1',
            canvasVersionId: 'version-move',
            contentHash: 'markdown-hash',
            sourcePaths: ['src/old.ts'],
            path: 'architecture/old.md',
            title: 'Old architecture',
            archived: false,
          }],
        }],
      }),
    }]);

    const result = await subject.listVersions({
      ...binding,
      selector: { type: 'WIKI_PAGE', path: 'architecture/current.md' },
      limit: 10,
    });

    expect(result.artifact.path).toBe('architecture/current.md');
    expect(result.versions[0]).toMatchObject({
      origin: 'WIKI_PIPELINE',
      checkpointRef: SHA.slice(0, 12),
      action: 'moved',
      archived: false,
      metadataStatus: 'exact',
      historicalIdentity: { path: 'architecture/old.md', title: 'Old architecture' },
      sourceEvidence: { sourcePathCount: 1, sourceReferenceCount: 0, status: 'FINALIZED' },
    });
  });

  it('reads exactly one version from the selected SDLC Canvas without mutating it', async () => {
    const artifact = {
      id: 'prd-1',
      title: 'Checkout PRD',
      metadata: { surface: 'SDLC', repoId: 'repo-1', artifactKind: 'PRD' },
    };
    const selected = version('version-1', '2026-08-13T12:00:00.000Z');
    const { prisma, store: subject } = store();
    prisma.canvas.findFirst.mockResolvedValue(artifact);
    prisma.canvasVersion.findFirst.mockResolvedValue(selected);
    jest.mocked(convertBlockNoteToMarkdown).mockResolvedValue('# Historical checkout');

    const result = await subject.readVersion({
      ...binding,
      selector: { type: 'SDLC_CANVAS', canvasId: 'prd-1' },
      versionId: 'version-1',
    });

    expect(result.artifact).toMatchObject({ canvasId: 'prd-1', artifactKind: 'PRD' });
    expect(result.version).toMatchObject({
      versionId: 'version-1',
      markdown: '# Historical checkout',
      revisionEvidence: null,
    });
    expect(prisma.canvasVersion.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'version-1', canvasId: 'prd-1' },
    }));
  });

  it('returns the same non-enumerating not-found response for cross-repository artifacts', async () => {
    const { prisma, store: subject } = store();
    prisma.canvas.findFirst.mockResolvedValue(null);

    await expect(subject.readVersion({
      ...binding,
      selector: { type: 'SDLC_CANVAS', canvasId: 'another-repo-canvas' },
      versionId: 'version-1',
    })).rejects.toMatchObject({ message: 'SDLC artifact not found', statusCode: 404 });
  });

  it('rejects a cursor that does not belong to the selected artifact', async () => {
    const { prisma, store: subject } = store();
    prisma.canvasVersion.findFirst.mockResolvedValue(null);

    await expect(subject.listVersions({
      ...binding,
      selector: { type: 'WIKI_PAGE', path: 'architecture/current.md' },
      cursor: 'foreign-version',
      limit: 10,
    })).rejects.toMatchObject({ message: 'Invalid artifact version cursor', statusCode: 400 });
  });

  it('reports malformed Wiki paths as request errors', async () => {
    const { store: subject } = store();

    await expect(subject.listVersions({
      ...binding,
      selector: { type: 'WIKI_PAGE', path: '../outside.md' },
      limit: 10,
    })).rejects.toMatchObject({
      message: 'Wiki path must be a normalized relative Markdown path',
      statusCode: 400,
    });
  });
});
