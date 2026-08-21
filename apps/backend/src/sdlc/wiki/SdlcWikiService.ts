import { Prisma, type PrismaClient } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import type { SdlcWiki, SdlcWikiActor, SdlcWikiPageSummary } from './types';
import { WIKI_FOLDER_PREFIX } from './wikiPaths';

function metadataRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export class SdlcWikiService implements SdlcWiki {
  constructor(private readonly prisma: PrismaClient = DatabaseClient.getInstance()) {}

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
            typeof metadata.wikiArchivedAt === 'string' ||
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
}

export const sdlcWiki = new SdlcWikiService();
