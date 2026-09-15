import { Prisma, type PrismaClient } from '@prisma/client';
import { SDLC_MEMBERSHIP_RELATION } from '@xyne/shared';
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
    // Membership is the read check.
    const membership = await this.prisma.sdlcEntityLink.findFirst({
      where: {
        workspaceId: actor.workspaceId,
        targetType: 'REPOSITORY',
        targetId: repoId,
        relationType: SDLC_MEMBERSHIP_RELATION,
        channel: { participants: { some: { userId: actor.userId } } },
      },
      orderBy: { createdAt: 'asc' },
      select: { channelId: true },
    });
    if (!membership?.channelId) throw new AppError('SDLC repository not found', 404);

    const folders = await this.prisma.canvasFolder.findMany({
      where: {
        channelId: membership.channelId,
        OR: [{ name: WIKI_FOLDER_PREFIX }, { name: { startsWith: `${WIKI_FOLDER_PREFIX}/` } }],
      },
      select: {
        name: true,
        canvases: {
          // Wiki folders are shared by the hub; each page belongs to one repository.
          where: { sdlcArtifact: { is: { artifactType: 'WIKI', repoId } } },
          select: {
            id: true,
            title: true,
            metadata: true,
            lastEditedAt: true,
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
          if (typeof metadata.wikiRelativePath !== 'string') {
            return [];
          }
          return [
            {
              canvasId: canvas.id,
              title: canvas.title,
              path: metadata.wikiRelativePath,
              folderPath: folder.name,
              syncedAt: (canvas.lastEditedAt ?? canvas.updatedAt).toISOString(),
              updatedAt: canvas.updatedAt.toISOString(),
            },
          ];
        })
      )
      .sort((left, right) => left.path.localeCompare(right.path));
  }
}

export const sdlcWiki = new SdlcWikiService();
