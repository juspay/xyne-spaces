jest.mock('../../../src/database/client', () => ({
  DatabaseClient: { getInstance: jest.fn() },
}));
jest.mock('../../../src/queues/vespaQueue', () => ({
  vespaQueue: { addJob: jest.fn() },
}));
jest.mock('../../../src/services/canvasService', () => ({
  convertBlockNoteToMarkdown: jest.fn(),
  convertMarkdownToBlockNote: jest.fn(),
}));
jest.mock('../../../src/utils/ysweetUtils', () => ({
  readFromYSweet: jest.fn(),
  syncToYSweet: jest.fn(),
}));
jest.mock('../../../src/sdlc/sdlcCanvasAccess', () => ({
  sdlcChannelCanvasParticipant: jest.fn(),
}));
jest.mock('../../../src/config/env', () => ({
  config: {
    env: 'test',
    logging: { level: 'error', fluent: { enabled: false, host: 'localhost', port: 24224 } },
  },
}));

import { SdlcWikiPageStore } from '../../../src/sdlc/wiki/SdlcWikiPageStore';
import { SdlcArtifactVersionStore } from '../../../src/sdlc/SdlcArtifactVersionStore';
import { serializeWikiRunState, type WikiExecutionContext } from '../../../src/sdlc/wiki/wikiRunState';
import {
  convertBlockNoteToMarkdown,
  convertMarkdownToBlockNote,
} from '../../../src/services/canvasService';
import { createHash } from 'crypto';

const SHA = 'a'.repeat(40);

function executionContext(): WikiExecutionContext {
  return {
    version: 1,
    repoId: 'repo-1',
    agentSlug: 'sdlc-agent',
    conversationId: 'conversation-1',
    sessionId: 'session-1',
    credentialSessionId: 'session-1',
    admissionPermitId: 'permit-1',
    phase: 'PROCESSING',
    runMode: 'INITIAL',
    historyRange: { kind: 'FULL' },
    chunkSize: 10,
    quality: 'STANDARD',
    baseBranch: 'main',
    targetHeadSha: SHA,
    bootstrapRef: 'ROOT_BOOTSTRAP',
    selectedStartSha: SHA,
    selectedCommitShas: [SHA],
    cursorSha: null,
    assignedChunk: {
      kind: 'COMMITS',
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      commitShas: [SHA],
      nextIndex: 0,
    },
    counts: { total: 1, processed: 0, updated: 0, noop: 0, failed: 0 },
    validatorReports: [],
    error: null,
    errorCode: null,
  };
}

function pageStore(checkpointCount: number, context = executionContext()) {
  const prisma = {
    workflowExecution: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'execution-1',
        context: serializeWikiRunState(context),
        output: JSON.stringify({ version: 1, outcomes: [] }),
        createdBy: 'user-1',
      }),
      updateMany: jest.fn().mockResolvedValue({ count: checkpointCount }),
    },
    repo: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'repo-1',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        channelId: 'channel-1',
        url: 'https://example.com/repo.git',
      }),
    },
    canvas: { findMany: jest.fn().mockResolvedValue([]) },
    canvasFolder: { upsert: jest.fn(), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $transaction: jest.fn(),
  };
  const dependencies = {
    readCanvas: jest.fn(),
    syncCanvas: jest.fn(),
    indexCanvas: jest.fn(),
    verifySourcePaths: jest.fn(),
    verifySourceRanges: jest.fn(),
  };
  return {
    prisma,
    dependencies,
    store: new SdlcWikiPageStore(prisma as never, dependencies as never),
  };
}

describe('SdlcWikiPageStore checkpoint concurrency', () => {
  it('begins a version-2 history-window checkpoint durably', async () => {
    const context = executionContext();
    const windowContext: WikiExecutionContext = {
      ...context,
      version: 2,
      executionModel: 'HISTORY_WINDOW',
      assignedChunk: {
        ...context.assignedChunk!,
        window: {
          beforeSha: 'ROOT_BOOTSTRAP',
          afterSha: SHA,
          activeCheckpointSha: null,
          completedCheckpointShas: [],
        },
      },
      counts: {
        ...context.counts,
        windows: { total: 1, completed: 0, updated: 0, noop: 0, failed: 0, intermediate: 0 },
      },
    };
    const { prisma, store } = pageStore(1, windowContext);

    await expect(
      store.beginCheckpoint({
        sessionId: 'session-1',
        request: { executionId: 'execution-1', commitSha: SHA },
      })
    ).resolves.toEqual({ checkpointSha: SHA, endpointSha: SHA });

    const next = JSON.parse(prisma.workflowExecution.updateMany.mock.calls[0][0].data.context);
    expect(next.assignedChunk.window.activeCheckpointSha).toBe(SHA);
  });

  it('creates the next nested bootstrap page while preserving earlier pending evidence', async () => {
    const context = executionContext();
    context.phase = 'BOOTSTRAPPING';
    context.bootstrapRef = SHA;
    context.assignedChunk = {
      kind: 'BOOTSTRAP_PAGE', conversationId: 'conversation-2', sessionId: 'session-1',
      commitShas: [SHA], nextIndex: 0,
    };
    context.bootstrapPlan = {
      repositorySummary: 'Repository', nextPageIndex: 1, pendingEditorialPath: null,
      correction: null, editorialReports: [], pages: [
        {
          path: 'overview.md', purpose: 'Overview', concepts: [], priority: 'HIGH',
          archetype: 'overview', sourceAreas: ['src'], relatedPages: [],
          tableCandidates: [], diagramCandidates: [],
        },
        {
          path: 'flows/security/authentication.md', purpose: 'Authentication', concepts: [], priority: 'HIGH',
          archetype: 'flow', sourceAreas: ['src/auth'], relatedPages: [],
          tableCandidates: [], diagramCandidates: [],
        },
      ],
    };
    context.pendingCommit = {
      commitSha: SHA,
      pages: [{
        path: 'overview.md', requestHash: 'first-page-request', writerSessionId: 'session-previous',
        revision: {
          action: 'created', commitSha: SHA, canvasId: 'canvas-overview',
          canvasVersionId: 'version-overview', contentHash: 'overview-hash',
          sourcePaths: ['src/main.ts'],
        },
      }],
    };
    const { prisma, dependencies, store } = pageStore(1, context);
    const blocks = [{ type: 'heading', content: 'Authentication' }];
    const canvasCreate = jest.fn().mockResolvedValue({ id: 'canvas-nested' });
    const versionCreate = jest.fn().mockResolvedValue({});
    prisma.canvasFolder.upsert.mockResolvedValue({ id: 'folder-nested' });
    prisma.repo.findUnique.mockResolvedValue({
      id: 'repo-1',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      channelId: 'channel-1',
      url: 'https://github.com/acme/repo.git',
    });
    prisma.$transaction.mockImplementation(
      async (
        callback: (tx: {
          canvas: { create: typeof canvasCreate };
          canvasVersion: { create: typeof versionCreate };
        }) => unknown
      ) => callback({ canvas: { create: canvasCreate }, canvasVersion: { create: versionCreate } })
    );
    dependencies.verifySourcePaths.mockResolvedValue(undefined);
    dependencies.syncCanvas.mockResolvedValue(true);
    dependencies.indexCanvas.mockResolvedValue(undefined);
    jest.mocked(convertBlockNoteToMarkdown).mockResolvedValueOnce('');
    jest.mocked(convertMarkdownToBlockNote).mockResolvedValueOnce(blocks as never);

    await expect(
      store.writePage({
        sessionId: 'session-1',
        request: {
          executionId: 'execution-1',
          commitSha: SHA,
          page: {
            action: 'create',
            path: 'flows/security/authentication.md',
            title: 'Authentication',
            markdown: '# Authentication\n\nEntry point: [[source:0]]',
            sourcePaths: ['src/auth/index.ts'],
            sourceReferences: [{
              path: 'src/auth/index.ts',
              symbol: 'authenticate()',
              startLine: 10,
              endLine: 20,
            }],
          },
        },
      })
    ).resolves.toMatchObject({
      writtenPages: 2,
      revision: { action: 'created', canvasId: 'canvas-nested' },
    });

    const nextContext = JSON.parse(prisma.workflowExecution.updateMany.mock.calls[0][0].data.context);
    expect(nextContext.pendingCommit.pages).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'overview.md', writerSessionId: 'session-previous' }),
      expect.objectContaining({ path: 'flows/security/authentication.md', writerSessionId: 'session-1' }),
    ]));

    expect(prisma.canvasFolder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId_channelId_name: {
            projectId: 'project-1',
            channelId: 'channel-1',
            name: 'Wiki/flows/security',
          },
        },
      })
    );
    expect(canvasCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          folderId: 'folder-nested',
          metadata: expect.objectContaining({
            wikiRelativePath: 'flows/security/authentication.md',
            wikiSourcePaths: ['src/auth/index.ts'],
            wikiSourceReferences: [{
              path: 'src/auth/index.ts',
              commitSha: SHA,
              symbol: 'authenticate()',
              startLine: 10,
              endLine: 20,
            }],
          }),
        }),
      })
    );
  });

  it('replaces pending evidence when the same session corrects a page before finalization', async () => {
    const firstMarkdown = '# Architecture\n\nFirst draft';
    const correctedMarkdown = '# Architecture\n\nCorrected draft';
    const firstHash = createHash('sha256').update(firstMarkdown).digest('hex');
    const context = executionContext();
    context.pendingCommit = {
      commitSha: SHA,
      pages: [{
        path: 'architecture.md',
        requestHash: 'old-request',
        revision: {
          action: 'updated',
          commitSha: SHA,
          canvasId: 'canvas-1',
          canvasVersionId: 'version-first',
          contentHash: firstHash,
          sourcePaths: ['src/main.ts'],
        },
      }],
    };
    const { prisma, dependencies, store } = pageStore(1, context);
    const firstContent = [{ type: 'heading', content: 'Architecture' }];
    const correctedContent = [{ type: 'heading', content: 'Corrected Architecture' }];
    prisma.canvas.findMany.mockResolvedValue([{
      id: 'canvas-1',
      title: 'Architecture',
      content: firstContent,
      folderId: 'folder-1',
      metadata: {
        surface: 'SDLC',
        documentKind: 'WIKI',
        repoId: 'repo-1',
        wikiRelativePath: 'architecture.md',
        wikiSourcePaths: ['src/main.ts'],
      },
    }]);
    const canvasUpdate = jest.fn().mockResolvedValue({});
    const versionUpsert = jest.fn().mockResolvedValue({ id: 'version-corrected' });
    prisma.canvasFolder.upsert.mockResolvedValue({ id: 'folder-1' });
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({ canvas: { update: canvasUpdate }, canvasVersion: { upsert: versionUpsert } })
    );
    dependencies.readCanvas.mockResolvedValue(firstContent);
    dependencies.verifySourcePaths.mockResolvedValue(undefined);
    dependencies.syncCanvas.mockResolvedValue(true);
    dependencies.indexCanvas.mockResolvedValue(undefined);
    jest.mocked(convertBlockNoteToMarkdown).mockResolvedValueOnce(firstMarkdown);
    jest.mocked(convertMarkdownToBlockNote).mockResolvedValueOnce(correctedContent as never);

    await store.writePage({
      sessionId: 'session-1',
      request: {
        executionId: 'execution-1',
        commitSha: SHA,
        page: {
          action: 'update',
          path: 'architecture.md',
          title: 'Architecture',
          markdown: correctedMarkdown,
          sourcePaths: ['src/main.ts'],
          expectedContentHash: firstHash,
        },
      },
    });

    const next = JSON.parse(prisma.workflowExecution.updateMany.mock.calls[0][0].data.context);
    expect(next.pendingCommit.pages).toHaveLength(1);
    expect(next.pendingCommit.pages[0]).toMatchObject({
      path: 'architecture.md',
      revision: {
        canvasVersionId: 'version-corrected',
        contentHash: createHash('sha256').update(correctedMarkdown).digest('hex'),
      },
    });
  });

  it('reads prior context, recovers one omitted section, and stores a new full CanvasVersion snapshot', async () => {
    const original = '# API\n\nIntro\n\n## Retries\n\nOld policy\n\n## Errors\n\nError policy\n';
    const expectedHash = createHash('sha256').update(original).digest('hex');
    const fullReplacement = '# API\n\nIntro\n\n## Retries\n\nThree attempts.\n\n## Errors\n\nError policy\n';
    const { prisma, dependencies, store } = pageStore(1);
    const content = [{ type: 'heading', content: 'API' }];
    prisma.canvas.findMany.mockResolvedValue([{
      id: 'canvas-api', title: 'API', content, folderId: 'folder-api',
      metadata: {
        surface: 'SDLC', documentKind: 'WIKI', repoId: 'repo-1',
        wikiRelativePath: 'interfaces/api.md', wikiSourcePaths: ['src/api.ts'],
      },
    }]);
    const versionUpsert = jest.fn().mockResolvedValue({ id: 'version-section' });
    prisma.canvasFolder.upsert.mockResolvedValue({ id: 'folder-api' });
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({ canvas: { update: jest.fn() }, canvasVersion: { upsert: versionUpsert } })
    );
    dependencies.readCanvas.mockResolvedValue(content);
    dependencies.verifySourcePaths.mockResolvedValue(undefined);
    dependencies.syncCanvas.mockResolvedValue(true);
    dependencies.indexCanvas.mockResolvedValue(undefined);
    jest.mocked(convertBlockNoteToMarkdown)
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(original);
    jest.mocked(convertMarkdownToBlockNote).mockResolvedValueOnce(content as never);

    const historyStore = new SdlcArtifactVersionStore({
      repo: { findFirst: jest.fn().mockResolvedValue({
        id: 'repo-1', channelId: 'channel-1', projectId: 'project-1',
      }) },
      canvas: { findMany: jest.fn().mockResolvedValue([{
        id: 'canvas-api', title: 'API',
        metadata: {
          surface: 'SDLC', documentKind: 'WIKI', repoId: 'repo-1',
          wikiRelativePath: 'interfaces/api.md', wikiSourcePaths: ['src/api.ts'],
        },
      }]) },
      canvasVersion: { findFirst: jest.fn().mockResolvedValue({
        id: 'version-before-omission', name: 'Before omission', content,
        contentHash: 'stored-version-hash', createdBy: 'user-1', createdAt: new Date(),
      }) },
      sdlcEntityLink: { findMany: jest.fn().mockResolvedValue([]) },
      workflowExecution: { findMany: jest.fn().mockResolvedValue([]) },
    } as never);
    const historical = await historyStore.readVersion({
      repoId: 'repo-1', workspaceId: 'workspace-1', userId: 'user-1',
      selector: { type: 'WIKI_PAGE', path: 'interfaces/api.md' },
      versionId: 'version-before-omission',
    });
    expect(historical.version.markdown).toContain('## Errors\n\nError policy');

    await store.writePage({
      sessionId: 'session-1',
      request: {
        executionId: 'execution-1', commitSha: SHA,
        page: {
          action: 'replace_section', path: 'interfaces/api.md', expectedContentHash: expectedHash,
          heading: 'Retries', markdown: '## Retries\n\nThree attempts.', sourcePaths: ['src/api.ts'],
        },
      },
    });

    expect(convertMarkdownToBlockNote).toHaveBeenCalledWith(fullReplacement);
    expect(versionUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ content }),
    }));
  });

  it('archives a whole topic through metadata while preserving its Canvas and sources', async () => {
    const { prisma, dependencies, store } = pageStore(1);
    const liveContent = [{ type: 'heading', content: 'Old topic' }];
    const markdown = '# Old topic';
    const expectedContentHash = createHash('sha256').update(markdown).digest('hex');
    const canvasUpdate = jest.fn().mockResolvedValue({});
    const versionUpsert = jest.fn().mockResolvedValue({ id: 'version-archive' });
    prisma.canvas.findMany.mockResolvedValue([
      {
        id: 'canvas-old-topic',
        title: 'Old topic',
        content: liveContent,
        folderId: 'folder-old-topic',
        metadata: {
          surface: 'SDLC',
          documentKind: 'WIKI',
          repoId: 'repo-1',
          wikiRelativePath: 'architecture/old-topic.md',
          wikiSourcePaths: ['src/old-topic.ts'],
          wikiContentHash: expectedContentHash,
        },
      },
    ]);
    prisma.canvasFolder.upsert.mockResolvedValue({ id: 'folder-old-topic' });
    prisma.$transaction.mockImplementation(
      async (
        callback: (tx: {
          canvas: { update: typeof canvasUpdate };
          canvasVersion: { upsert: typeof versionUpsert };
        }) => unknown
      ) =>
        callback({
          canvas: { update: canvasUpdate },
          canvasVersion: { upsert: versionUpsert },
        })
    );
    dependencies.readCanvas.mockResolvedValue(liveContent);
    dependencies.verifySourcePaths.mockResolvedValue(undefined);
    dependencies.indexCanvas.mockResolvedValue(undefined);
    jest.mocked(convertBlockNoteToMarkdown).mockResolvedValueOnce(markdown);

    await expect(
      store.writePage({
        sessionId: 'session-1',
        request: {
          executionId: 'execution-1',
          commitSha: SHA,
          page: {
            action: 'archive',
            path: 'architecture/old-topic.md',
            expectedContentHash,
            sourcePaths: [],
          },
        },
      })
    ).resolves.toMatchObject({
      writtenPages: 1,
      revision: {
        action: 'archived',
        canvasId: 'canvas-old-topic',
        canvasVersionId: 'version-archive',
        sourcePaths: ['src/old-topic.ts'],
      },
    });

    expect(versionUpsert).toHaveBeenCalledTimes(1);
    expect(canvasUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'canvas-old-topic' },
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            wikiSourcePaths: [],
            wikiArchivedSourcePaths: ['src/old-topic.ts'],
            wikiArchivedByCommit: SHA,
            wikiCanvasVersionId: 'version-archive',
          }),
        }),
      })
    );
    expect(dependencies.syncCanvas).not.toHaveBeenCalled();
  });

  it('moves a nested Wiki page while preserving Canvas identity, content, sources, and history', async () => {
    const { prisma, dependencies, store } = pageStore(1);
    const content = [{ type: 'heading', content: 'Authentication' }];
    const markdown = '# Authentication';
    const expectedContentHash = createHash('sha256').update(markdown).digest('hex');
    const canvasUpdate = jest.fn().mockResolvedValue({});
    const versionUpsert = jest.fn().mockResolvedValue({ id: 'version-move' });
    prisma.canvas.findMany.mockResolvedValue([
      {
        id: 'canvas-auth',
        title: 'Authentication',
        content,
        folderId: 'folder-old',
        metadata: {
          surface: 'SDLC',
          documentKind: 'WIKI',
          repoId: 'repo-1',
          wikiRelativePath: 'architecture/authentication.md',
          wikiSourcePaths: ['src/auth/index.ts'],
        },
      },
    ]);
    prisma.canvasFolder.upsert.mockResolvedValue({ id: 'folder-new' });
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) =>
        callback({ canvas: { update: canvasUpdate }, canvasVersion: { upsert: versionUpsert } })
    );
    dependencies.readCanvas.mockResolvedValue(content);
    dependencies.indexCanvas.mockResolvedValue(undefined);
    jest.mocked(convertBlockNoteToMarkdown).mockResolvedValueOnce(markdown);

    await expect(
      store.movePage({
        sessionId: 'session-1',
        request: {
          executionId: 'execution-1',
          commitSha: SHA,
          sourcePath: 'architecture/authentication.md',
          destinationPath: 'subsystems/security/authentication.md',
          expectedContentHash,
        },
      })
    ).resolves.toMatchObject({
      writtenPages: 1,
      revision: {
        action: 'moved',
        canvasId: 'canvas-auth',
        canvasVersionId: 'version-move',
        sourcePaths: ['src/auth/index.ts'],
      },
    });
    expect(canvasUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'canvas-auth' },
        data: expect.objectContaining({
          folderId: 'folder-new',
          metadata: expect.objectContaining({
            wikiRelativePath: 'subsystems/security/authentication.md',
            wikiMovedFromPath: 'architecture/authentication.md',
            wikiMovedToPath: 'subsystems/security/authentication.md',
            wikiRevisionKind: 'moved',
          }),
        }),
      })
    );
    expect(dependencies.syncCanvas).not.toHaveBeenCalled();
  });

  it('repairs move evidence idempotently after the Canvas move already committed', async () => {
    const { prisma, dependencies, store } = pageStore(1);
    const markdown = '# Authentication';
    const expectedContentHash = createHash('sha256').update(markdown).digest('hex');
    prisma.canvas.findMany.mockResolvedValue([
      {
        id: 'canvas-auth',
        title: 'Authentication',
        content: [{ type: 'heading', content: 'Authentication' }],
        folderId: 'folder-new',
        metadata: {
          surface: 'SDLC',
          documentKind: 'WIKI',
          repoId: 'repo-1',
          wikiRelativePath: 'subsystems/security/authentication.md',
          wikiSourcePaths: ['src/auth/index.ts'],
          wikiLastCommitSha: SHA,
          wikiRevisionKind: 'moved',
          wikiCanvasVersionId: 'version-move',
          wikiMovedFromPath: 'architecture/authentication.md',
        },
      },
    ]);
    dependencies.readCanvas.mockResolvedValue([{ type: 'heading', content: 'Authentication' }]);
    dependencies.indexCanvas.mockResolvedValue(undefined);
    jest.mocked(convertBlockNoteToMarkdown).mockResolvedValueOnce(markdown);

    await expect(
      store.movePage({
        sessionId: 'session-1',
        request: {
          executionId: 'execution-1',
          commitSha: SHA,
          sourcePath: 'architecture/authentication.md',
          destinationPath: 'subsystems/security/authentication.md',
          expectedContentHash,
        },
      })
    ).resolves.toMatchObject({
      revision: { action: 'moved', canvasId: 'canvas-auth', canvasVersionId: 'version-move' },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.workflowExecution.updateMany).toHaveBeenCalledTimes(1);
  });

  it('restores an archived topic on the same Canvas with verified current sources', async () => {
    const { prisma, dependencies, store } = pageStore(1);
    const archivedContent = [{ type: 'heading', content: 'Old topic' }];
    const restoredContent = [{ type: 'heading', content: 'Restored topic' }];
    const archivedMarkdown = '# Old topic';
    const expectedContentHash = createHash('sha256').update(archivedMarkdown).digest('hex');
    const canvasUpdate = jest.fn().mockResolvedValue({});
    const versionUpsert = jest.fn().mockResolvedValue({ id: 'version-restore' });
    prisma.canvas.findMany.mockResolvedValue([
      {
        id: 'canvas-old-topic',
        title: 'Old topic',
        content: archivedContent,
        folderId: 'folder-old-topic',
        metadata: {
          surface: 'SDLC',
          documentKind: 'WIKI',
          repoId: 'repo-1',
          wikiRelativePath: 'architecture/old-topic.md',
          wikiSourcePaths: [],
          wikiArchivedSourcePaths: ['src/old-topic.ts'],
          wikiArchivedAt: '2026-08-11T00:00:00.000Z',
          wikiArchivedByCommit: 'b'.repeat(40),
          wikiContentHash: expectedContentHash,
        },
      },
    ]);
    prisma.canvasFolder.upsert.mockResolvedValue({ id: 'folder-old-topic' });
    prisma.$transaction.mockImplementation(
      async (
        callback: (tx: {
          canvas: { update: typeof canvasUpdate };
          canvasVersion: { upsert: typeof versionUpsert };
        }) => unknown
      ) =>
        callback({
          canvas: { update: canvasUpdate },
          canvasVersion: { upsert: versionUpsert },
        })
    );
    dependencies.readCanvas.mockResolvedValue(archivedContent);
    dependencies.verifySourcePaths.mockResolvedValue(undefined);
    dependencies.syncCanvas.mockResolvedValue(true);
    dependencies.indexCanvas.mockResolvedValue(undefined);
    jest.mocked(convertBlockNoteToMarkdown).mockResolvedValueOnce(archivedMarkdown);
    jest.mocked(convertMarkdownToBlockNote).mockResolvedValueOnce(restoredContent as never);

    await expect(
      store.writePage({
        sessionId: 'session-1',
        request: {
          executionId: 'execution-1',
          commitSha: SHA,
          page: {
            action: 'restore',
            path: 'architecture/old-topic.md',
            title: 'Restored topic',
            markdown: '# Restored topic',
            expectedContentHash,
            sourcePaths: ['src/restored-topic.ts'],
          },
        },
      })
    ).resolves.toMatchObject({
      writtenPages: 1,
      revision: {
        action: 'restored',
        canvasId: 'canvas-old-topic',
        canvasVersionId: 'version-restore',
        sourcePaths: ['src/restored-topic.ts'],
      },
    });

    expect(dependencies.verifySourcePaths).toHaveBeenCalledWith('repo-1', SHA, [
      'src/restored-topic.ts',
    ]);
    expect(canvasUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'canvas-old-topic' },
        data: expect.objectContaining({
          title: 'Restored topic',
          metadata: expect.objectContaining({
            wikiRelativePath: 'architecture/old-topic.md',
            wikiSourcePaths: ['src/restored-topic.ts'],
            wikiArchivedAt: null,
            wikiArchivedByCommit: null,
            wikiCanvasVersionId: 'version-restore',
          }),
        }),
      })
    );
    expect(dependencies.syncCanvas).toHaveBeenCalledWith('canvas-old-topic', restoredContent);
  });

  it('records exactly one page without advancing the commit checkpoint', async () => {
    const { prisma, dependencies, store } = pageStore(1);
    const markdown = '# Durable page';
    const contentHash = createHash('sha256').update(markdown).digest('hex');
    const storedContent = [{ type: 'heading', content: 'Durable page' }];
    prisma.canvas.findMany.mockResolvedValue([
      {
        id: 'canvas-1',
        title: 'Architecture',
        content: storedContent,
        folderId: 'folder-1',
        metadata: {
          surface: 'SDLC',
          documentKind: 'WIKI',
          repoId: 'repo-1',
          wikiRelativePath: 'architecture.md',
          wikiSourcePaths: ['src/main.ts'],
          wikiLastCommitSha: SHA,
          wikiRevisionKind: 'updated',
          wikiCanvasVersionId: 'version-1',
          wikiContentHash: contentHash,
        },
      },
    ]);
    dependencies.verifySourcePaths.mockResolvedValue(undefined);
    dependencies.syncCanvas.mockResolvedValue(true);
    dependencies.indexCanvas.mockResolvedValue(undefined);

    await expect(
      store.writePage({
        sessionId: 'session-1',
        request: {
          executionId: 'execution-1',
          commitSha: SHA,
          page: {
            action: 'update',
            path: 'architecture.md',
            title: 'Architecture',
            markdown,
            sourcePaths: ['src/main.ts'],
            expectedContentHash: 'previous-hash',
          },
        },
      })
    ).resolves.toMatchObject({ writtenPages: 1 });

    const update = prisma.workflowExecution.updateMany.mock.calls[0][0];
    const nextContext = JSON.parse(update.data.context) as WikiExecutionContext;
    expect(nextContext.cursorSha).toBeNull();
    expect(nextContext.counts.processed).toBe(0);
    expect(nextContext.pendingCommit?.pages).toHaveLength(1);
    expect(update.data.output).toBeUndefined();
  });

  it('advances only when pending page writes are explicitly finalized', async () => {
    const context = executionContext();
    context.pendingCommit = {
      commitSha: SHA,
      pages: [
        {
          path: 'architecture.md',
          requestHash: 'request-hash',
          revision: {
            action: 'updated',
            commitSha: SHA,
            canvasId: 'canvas-1',
            canvasVersionId: 'version-1',
            contentHash: 'content-hash',
            sourcePaths: ['src/main.ts'],
          },
        },
      ],
    };
    const { prisma, store } = pageStore(1, context);

    await expect(
      store.finalizeCommit({
        sessionId: 'session-1',
        request: {
          executionId: 'execution-1',
          commitSha: SHA,
          outcome: 'changes',
          summary: 'Architecture updated',
        },
      })
    ).resolves.toMatchObject({ cursorSha: SHA, revisions: [{ canvasId: 'canvas-1' }] });

    const update = prisma.workflowExecution.updateMany.mock.calls[0][0];
    const nextContext = JSON.parse(update.data.context) as WikiExecutionContext;
    expect(nextContext.pendingCommit).toBeNull();
    expect(nextContext.counts).toMatchObject({ processed: 1, updated: 1, noop: 0 });
  });

  it('rejects changes finalization when no page write completed', async () => {
    const { prisma, store } = pageStore(1);
    await expect(
      store.finalizeCommit({
        sessionId: 'session-1',
        request: {
          executionId: 'execution-1',
          commitSha: SHA,
          outcome: 'changes',
          summary: 'Missing page write',
        },
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.workflowExecution.updateMany).not.toHaveBeenCalled();
  });

  it('returns an already-recorded identical page write without writing it again', async () => {
    const page = {
      action: 'update' as const,
      path: 'architecture.md',
      title: 'Architecture',
      markdown: '# Durable page',
      sourcePaths: ['src/main.ts'],
      expectedContentHash: 'previous-hash',
    };
    const context = executionContext();
    context.pendingCommit = {
      commitSha: SHA,
      pages: [
        {
          path: page.path,
          requestHash: createHash('sha256').update(JSON.stringify(page)).digest('hex'),
          revision: {
            action: 'updated',
            commitSha: SHA,
            canvasId: 'canvas-1',
            canvasVersionId: 'version-1',
            contentHash: 'content-hash',
            sourcePaths: page.sourcePaths,
          },
        },
      ],
    };
    const { prisma, dependencies, store } = pageStore(1, context);

    await expect(
      store.writePage({
        sessionId: 'session-1',
        request: { executionId: 'execution-1', commitSha: SHA, page },
      })
    ).resolves.toMatchObject({ writtenPages: 1, revision: { canvasId: 'canvas-1' } });
    expect(prisma.canvas.findMany).not.toHaveBeenCalled();
    expect(dependencies.verifySourcePaths).not.toHaveBeenCalled();
    expect(prisma.workflowExecution.updateMany).not.toHaveBeenCalled();
  });

  it('blocks a second different mutation after a bootstrap page was written', async () => {
    const context = executionContext();
    context.phase = 'BOOTSTRAPPING';
    context.bootstrapRef = SHA;
    context.assignedChunk = {
      kind: 'BOOTSTRAP_PAGE', conversationId: 'conversation-1', sessionId: 'session-1',
      commitShas: [SHA], nextIndex: 0,
    };
    context.bootstrapPlan = {
      repositorySummary: 'Repository', nextPageIndex: 0, pendingEditorialPath: null,
      correction: null, editorialReports: [], pages: [{
        path: 'overview.md', purpose: 'Overview', concepts: [], priority: 'HIGH',
        archetype: 'overview', sourceAreas: ['src'], relatedPages: [],
        tableCandidates: [], diagramCandidates: [],
      }],
    };
    context.pendingCommit = {
      commitSha: SHA,
      pages: [{
        path: 'overview.md', requestHash: 'original-request', writerSessionId: 'session-1', revision: {
          action: 'created', commitSha: SHA, canvasId: 'canvas-1', canvasVersionId: 'version-1',
          contentHash: 'content-hash', sourcePaths: ['src/main.ts'],
        },
      }],
    };
    const { store } = pageStore(1, context);

    await expect(store.writePage({
      sessionId: 'session-1',
      request: { executionId: 'execution-1', commitSha: SHA, page: {
        action: 'update', path: 'overview.md', title: 'Overview', markdown: '# Changed',
        sourcePaths: ['src/main.ts'], expectedContentHash: 'content-hash',
      } },
    })).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('PAGE_ALREADY_WRITTEN') });
  });

  it('rejects a bootstrap write for a page other than the assigned plan entry', async () => {
    const context = executionContext();
    context.phase = 'BOOTSTRAPPING';
    context.bootstrapRef = SHA;
    context.assignedChunk = {
      kind: 'BOOTSTRAP_PAGE', conversationId: 'conversation-1', sessionId: 'session-1',
      commitShas: [SHA], nextIndex: 0,
    };
    context.bootstrapPlan = {
      repositorySummary: 'Repository', nextPageIndex: 0, pendingEditorialPath: null,
      correction: null, editorialReports: [], pages: [{
        path: 'overview.md', purpose: 'Overview', concepts: [], priority: 'HIGH',
        archetype: 'overview', sourceAreas: ['src'], relatedPages: [],
        tableCandidates: [], diagramCandidates: [],
      }],
    };
    const { store } = pageStore(1, context);

    await expect(store.writePage({
      sessionId: 'session-1',
      request: { executionId: 'execution-1', commitSha: SHA, page: {
        action: 'create', path: 'architecture.md', title: 'Architecture',
        markdown: '# Architecture', sourcePaths: ['src/main.ts'],
      } },
    })).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('[PAGE_NOT_ASSIGNED]'),
    });
  });

  it('atomically advances a no-op checkpoint', async () => {
    const { prisma, store } = pageStore(1);
    await expect(
      store.finalizeCommit({
        sessionId: 'session-1',
        request: {
          executionId: 'execution-1',
          commitSha: SHA,
          outcome: 'noop',
          summary: 'No durable Wiki impact',
        },
      })
    ).resolves.toEqual({ cursorSha: SHA, revisions: [] });
    expect(prisma.workflowExecution.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'execution-1' }),
      })
    );
  });

  it('rejects a stale concurrent checkpoint instead of overwriting it', async () => {
    const { store } = pageStore(0);
    await expect(
      store.finalizeCommit({
        sessionId: 'session-1',
        request: {
          executionId: 'execution-1',
          commitSha: SHA,
          outcome: 'noop',
          summary: 'No durable Wiki impact',
        },
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects a stale live-canvas hash and preserves the human edit', async () => {
    const { prisma, dependencies, store } = pageStore(1);
    const liveContent = [{ type: 'paragraph', content: 'human edit' }];
    prisma.canvas.findMany.mockResolvedValue([
      {
        id: 'canvas-1',
        title: 'Architecture',
        content: [{ type: 'paragraph', content: 'database copy' }],
        folderId: 'folder-1',
        metadata: {
          surface: 'SDLC',
          documentKind: 'WIKI',
          repoId: 'repo-1',
          wikiRelativePath: 'architecture.md',
          wikiSourcePaths: ['src/main.ts'],
        },
      },
    ]);
    dependencies.readCanvas.mockResolvedValue(liveContent);
    dependencies.verifySourcePaths.mockResolvedValue(undefined);
    jest.mocked(convertBlockNoteToMarkdown).mockResolvedValue('# Human edit');

    await expect(
      store.writePage({
        sessionId: 'session-1',
        request: {
          executionId: 'execution-1',
          commitSha: SHA,
          page: {
            action: 'update',
            path: 'architecture.md',
            title: 'Architecture',
            markdown: '# Generated replacement',
            sourcePaths: ['src/main.ts'],
            expectedContentHash: 'stale-hash',
          },
        },
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('[CONTENT_CONFLICT]'),
    });
    expect(dependencies.syncCanvas).not.toHaveBeenCalled();
    expect(prisma.workflowExecution.updateMany).not.toHaveBeenCalled();
  });

  it('repairs sync/index after a page DB write without creating a duplicate revision', async () => {
    const { prisma, dependencies, store } = pageStore(1);
    const markdown = '# Durable page';
    const contentHash = createHash('sha256').update(markdown).digest('hex');
    const storedContent = [{ type: 'heading', content: 'Durable page' }];
    prisma.canvas.findMany.mockResolvedValue([
      {
        id: 'canvas-1',
        title: 'Architecture',
        content: storedContent,
        folderId: 'folder-1',
        metadata: {
          surface: 'SDLC',
          documentKind: 'WIKI',
          repoId: 'repo-1',
          wikiRelativePath: 'architecture.md',
          wikiSourcePaths: ['src/main.ts'],
          wikiLastCommitSha: SHA,
          wikiRevisionKind: 'updated',
          wikiCanvasVersionId: 'version-1',
          wikiContentHash: contentHash,
        },
      },
    ]);
    dependencies.verifySourcePaths.mockResolvedValue(undefined);
    dependencies.syncCanvas.mockResolvedValue(true);
    dependencies.indexCanvas.mockResolvedValue(undefined);

    await expect(
      store.writePage({
        sessionId: 'session-1',
        request: {
          executionId: 'execution-1',
          commitSha: SHA,
          page: {
            action: 'update',
            path: 'architecture.md',
            title: 'Architecture',
            markdown,
            sourcePaths: ['src/main.ts'],
            expectedContentHash: 'previous-hash',
          },
        },
      })
    ).resolves.toMatchObject({
      writtenPages: 1,
      revision: {
        action: 'updated',
        commitSha: SHA,
        canvasId: 'canvas-1',
        canvasVersionId: 'version-1',
        contentHash,
        sourcePaths: ['src/main.ts'],
      },
    });
    expect(dependencies.syncCanvas).toHaveBeenCalledWith('canvas-1', storedContent);
    expect(dependencies.indexCanvas).toHaveBeenCalledTimes(1);
    expect(prisma.workflowExecution.updateMany).toHaveBeenCalledTimes(1);
  });
});
