import { createHash, randomUUID } from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { CanvasRole, CanvasVisibility } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { vespaQueue } from '@/queues/vespaQueue';
import { convertMarkdownToBlockNote } from '@/services/canvasService';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import { syncToYSweet } from '@/utils/ysweetUtils';
import { fileSchema, SubApp } from '@/vespa/src/types';
import type {
  SdlcWiki,
  SdlcWikiActor,
  SdlcWikiPageInput,
  SdlcWikiPageSummary,
  SdlcWikiPageSyncResult,
  SdlcWikiSyncResult,
  SyncSdlcWikiInput,
} from './types';
import { normalizeWikiSourcePath, WIKI_FOLDER_PREFIX, wikiFolderName } from './wikiPaths';

const WIKI_SOURCE = 'research-agent';
const MAX_WIKI_MARKDOWN_BYTES = 5_000_000;

interface SdlcWikiDependencies {
  syncCanvas(canvasId: string, content: BlockNoteBlock[]): Promise<boolean>;
  indexCanvas(input: { canvasId: string; userId: string; workspaceId: string }): Promise<void>;
}

interface WikiRepository {
  id: string;
  workspaceId: string;
  projectId: string;
  channelId: string;
  createdBy: string;
  url: string;
}

interface ExistingWikiCanvas {
  id: string;
  title: string;
  folderId: string | null;
  metadata: Prisma.JsonValue;
}

function metadataRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function wikiKey(sourceRepository: string, sourcePath: string): string {
  return `${sourceRepository}\u0000${sourcePath}`;
}

const defaultDependencies: SdlcWikiDependencies = {
  syncCanvas: syncToYSweet,
  async indexCanvas({ canvasId, userId, workspaceId }) {
    await vespaQueue.addJob({
      schema: fileSchema,
      docId: canvasId,
      jobType: 'feed',
      userId,
      workspaceId,
      app: SubApp.CANVAS,
    });
  },
};

export class SdlcWikiService implements SdlcWiki {
  constructor(
    private readonly prisma: PrismaClient = DatabaseClient.getInstance(),
    private readonly dependencies: SdlcWikiDependencies = defaultDependencies
  ) {}

  async listPages(actor: SdlcWikiActor, repoId: string): Promise<SdlcWikiPageSummary[]> {
    const repo = await this.prisma.repo.findFirst({
      where: {
        id: repoId,
        workspaceId: actor.workspaceId,
        channel: { participants: { some: { userId: actor.userId } } },
      },
      select: { channelId: true },
    });
    if (!repo?.channelId) throw new AppError('SDLC repository not found', 404);

    const folders = await this.prisma.canvasFolder.findMany({
      where: {
        channelId: repo.channelId,
        OR: [{ name: WIKI_FOLDER_PREFIX }, { name: { startsWith: `${WIKI_FOLDER_PREFIX}/` } }],
      },
      select: {
        name: true,
        canvases: {
          select: {
            id: true,
            title: true,
            metadata: true,
            updatedAt: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return folders
      .flatMap((folder) =>
        folder.canvases.flatMap((canvas) => {
          const metadata = metadataRecord(canvas.metadata);
          if (
            metadata.surface !== 'SDLC' ||
            metadata.repoId !== repoId ||
            metadata.documentKind !== 'WIKI' ||
            typeof metadata.wikiRelativePath !== 'string'
          ) {
            return [];
          }
          return [
            {
              canvasId: canvas.id,
              title: canvas.title,
              path: metadata.wikiRelativePath,
              folderPath: folder.name,
              syncedAt:
                typeof metadata.wikiSyncedAt === 'string'
                  ? metadata.wikiSyncedAt
                  : canvas.updatedAt.toISOString(),
              updatedAt: canvas.updatedAt.toISOString(),
            },
          ];
        })
      )
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  async syncPages(input: SyncSdlcWikiInput): Promise<SdlcWikiSyncResult> {
    const sourceRepository = input.sourceRepository.trim().replace(/^\/+|\/+$/g, '');
    if (!sourceRepository) throw new Error('sourceRepository is required');

    const repo = await this.requireWikiRepository(input.repoId);
    const preparedPages = this.preparePages(sourceRepository, input.pages);
    const [folders, canvases] = await Promise.all([
      this.prisma.canvasFolder.findMany({
        where: {
          channelId: repo.channelId,
          OR: [{ name: WIKI_FOLDER_PREFIX }, { name: { startsWith: `${WIKI_FOLDER_PREFIX}/` } }],
        },
        select: { id: true, name: true },
      }),
      this.prisma.canvas.findMany({
        where: { channelId: repo.channelId },
        select: { id: true, title: true, folderId: true, metadata: true },
      }),
    ]);
    const folderByName = new Map(folders.map((folder) => [folder.name, folder.id]));
    const canvasByKey = this.indexExistingCanvases(sourceRepository, canvases);

    const pages: SdlcWikiPageSyncResult[] = [];
    for (const page of preparedPages) {
      try {
        const folderId = await this.ensureFolder(repo, page.folderName, folderByName);
        const existing = canvasByKey.get(wikiKey(sourceRepository, page.sourcePath));
        const result = await this.syncPage(repo, sourceRepository, page, folderId, existing);
        pages.push(result);
      } catch (error) {
        pages.push({
          sourcePath: page.sourcePath,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      created: pages.filter((page) => page.status === 'created').length,
      updated: pages.filter((page) => page.status === 'updated').length,
      unchanged: pages.filter((page) => page.status === 'unchanged').length,
      failed: pages.filter((page) => page.status === 'failed').length,
      pages,
    };
  }

  private async requireWikiRepository(repoId: string): Promise<WikiRepository> {
    const repo = await this.prisma.repo.findUnique({
      where: { id: repoId },
      select: {
        id: true,
        workspaceId: true,
        projectId: true,
        channelId: true,
        createdBy: true,
        url: true,
      },
    });
    if (!repo?.workspaceId || !repo.projectId || !repo.channelId) {
      throw new Error('SDLC_REPO_ID must identify an attached SDLC repository');
    }
    return repo as WikiRepository;
  }

  private preparePages(sourceRepository: string, pages: SdlcWikiPageInput[]) {
    if (pages.length === 0) throw new Error('Research Agent returned no Wiki pages');
    const seen = new Set<string>();
    return pages.map((page) => {
      const sourcePath = normalizeWikiSourcePath(sourceRepository, page.sourcePath);
      const key = wikiKey(sourceRepository, sourcePath);
      if (seen.has(key)) throw new Error(`Duplicate Wiki path: ${page.sourcePath}`);
      seen.add(key);

      const title = page.title.trim();
      if (!title || title.length > 255) {
        throw new Error(`Wiki title must contain 1-255 characters: ${page.sourcePath}`);
      }
      if (!page.markdown.trim()) throw new Error(`Wiki page is empty: ${page.sourcePath}`);
      if (Buffer.byteLength(page.markdown, 'utf8') > MAX_WIKI_MARKDOWN_BYTES) {
        throw new Error(`Wiki page exceeds 5 MB: ${page.sourcePath}`);
      }
      return {
        sourcePath,
        title,
        markdown: page.markdown,
        contentHash: createHash('sha256').update(page.markdown).digest('hex'),
        folderName: wikiFolderName(sourcePath),
      };
    });
  }

  private indexExistingCanvases(
    sourceRepository: string,
    canvases: ExistingWikiCanvas[]
  ): Map<string, ExistingWikiCanvas> {
    const indexed = new Map<string, ExistingWikiCanvas>();
    for (const canvas of canvases) {
      const metadata = metadataRecord(canvas.metadata);
      if (
        metadata.documentKind !== 'WIKI' ||
        metadata.wikiSource !== WIKI_SOURCE ||
        metadata.wikiSourceRepository !== sourceRepository ||
        typeof metadata.wikiRelativePath !== 'string'
      ) {
        continue;
      }
      const key = wikiKey(sourceRepository, metadata.wikiRelativePath);
      if (indexed.has(key))
        throw new Error(`Duplicate imported Wiki canvas: ${metadata.wikiRelativePath}`);
      indexed.set(key, canvas);
    }
    return indexed;
  }

  private async ensureFolder(
    repo: WikiRepository,
    folderName: string,
    folderByName: Map<string, string>
  ): Promise<string> {
    const known = folderByName.get(folderName);
    if (known) return known;

    const folder = await this.prisma.canvasFolder.upsert({
      where: {
        projectId_channelId_name: {
          projectId: repo.projectId,
          channelId: repo.channelId,
          name: folderName,
        },
      },
      create: {
        workspaceId: repo.workspaceId,
        projectId: repo.projectId,
        channelId: repo.channelId,
        name: folderName,
        createdBy: repo.createdBy,
      },
      update: {},
      select: { id: true },
    });
    folderByName.set(folderName, folder.id);
    return folder.id;
  }

  private async syncPage(
    repo: WikiRepository,
    sourceRepository: string,
    page: {
      sourcePath: string;
      title: string;
      markdown: string;
      contentHash: string;
      folderName: string;
    },
    folderId: string,
    existing: ExistingWikiCanvas | undefined
  ): Promise<SdlcWikiPageSyncResult> {
    const content = await convertMarkdownToBlockNote(page.markdown);
    if (content.length === 0) throw new Error('Markdown could not be converted to Canvas blocks');

    const now = new Date();
    const previousMetadata = metadataRecord(existing?.metadata ?? null);
    const changed =
      !existing ||
      existing.title !== page.title ||
      existing.folderId !== folderId ||
      previousMetadata.wikiContentHash !== page.contentHash;
    const metadata: Prisma.InputJsonObject = {
      ...previousMetadata,
      source: WIKI_SOURCE,
      surface: 'SDLC',
      repoId: repo.id,
      projectId: repo.projectId,
      repositoryUrl: repo.url,
      documentKind: 'WIKI',
      wikiSource: WIKI_SOURCE,
      wikiSourceRepository: sourceRepository,
      wikiRelativePath: page.sourcePath,
      wikiContentHash: page.contentHash,
      wikiSyncedAt: now.toISOString(),
    };

    const canvas = existing
      ? changed
        ? await this.prisma.canvas.update({
            where: { id: existing.id },
            data: {
              title: page.title,
              content: content as unknown as Prisma.InputJsonValue,
              folderId,
              metadata,
              lastEditedBy: repo.createdBy,
              lastEditedAt: now,
            },
            select: { id: true },
          })
        : { id: existing.id }
      : await this.prisma.canvas.create({
          data: {
            workspaceId: repo.workspaceId,
            title: page.title,
            content: content as unknown as Prisma.InputJsonValue,
            channelId: repo.channelId,
            folderId,
            projectId: repo.projectId,
            createdBy: repo.createdBy,
            lastEditedBy: repo.createdBy,
            lastEditedAt: now,
            viewAccessId: randomUUID(),
            visibility: CanvasVisibility.PRIVATE,
            isCollaborative: true,
            metadata,
            participants: {
              create: {
                workspaceId: repo.workspaceId,
                channelId: repo.channelId,
                role: CanvasRole.VIEWER,
              },
            },
          },
          select: { id: true },
        });

    const synced = await this.dependencies.syncCanvas(canvas.id, content);
    if (!synced) throw new Error('Canvas was saved, but Y-Sweet synchronization failed');
    await this.dependencies.indexCanvas({
      canvasId: canvas.id,
      userId: repo.createdBy,
      workspaceId: repo.workspaceId,
    });

    return {
      sourcePath: page.sourcePath,
      status: existing ? (changed ? 'updated' : 'unchanged') : 'created',
      canvasId: canvas.id,
    };
  }
}

export const sdlcWiki = new SdlcWikiService();
