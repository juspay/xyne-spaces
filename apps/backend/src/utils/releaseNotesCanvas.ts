import { DatabaseClient } from '@/database/client';

const prisma = DatabaseClient.getInstance();

// The release notes canvas of a release ticket (written by the release workflow's LINK_RELEASE_NOTES step).
export async function findReleaseNotesCanvasId(releaseId: string, workspaceId: string): Promise<string | null> {
  const canvas = await prisma.canvas.findFirst({
    where: {
      workspaceId,
      AND: [
        { metadata: { path: ['source'], equals: 'release_notes' } },
        { metadata: { path: ['releaseTicketId'], equals: releaseId } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
  return canvas?.id ?? null;
}
