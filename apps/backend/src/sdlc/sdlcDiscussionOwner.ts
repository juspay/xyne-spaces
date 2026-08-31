import type { SdlcDiscussion, SdlcEntityType, SdlcRelationType } from '@xyne/shared';

export type SdlcDiscussionSurfaceType = NonNullable<SdlcDiscussion['surfaceType']>;

export interface SdlcDiscussionOwnerLookup {
  getCanvas: (id: string) => Promise<{
    id: string;
    workspaceId: string;
    channelId: string | null;
    artifactType: string;
  } | null>;
  getTicket: (id: string) => Promise<{
    id: string;
    workspaceId: string;
    channelId: string;
  } | null>;
  getPullRequest: (id: string) => Promise<{ id: string; workspaceId: string } | null>;
  findLinkSource: (input: {
    repoId: string;
    targetType: Extract<SdlcEntityType, 'CANVAS' | 'TICKET' | 'PULL_REQUEST'>;
    targetId: string;
    relationType: Extract<SdlcRelationType, 'TICKET' | 'PULL_REQUEST'>;
  }) => Promise<{ sourceType: 'CANVAS' | 'TICKET'; sourceId: string } | null>;
}

export async function resolveSdlcDiscussionOwnerId(
  input: {
    workspaceId: string;
    repoId: string;
    channelId: string;
    surfaceType: SdlcDiscussionSurfaceType;
    surfaceId: string;
  },
  lookup: SdlcDiscussionOwnerLookup
): Promise<string | null> {
  const canvasOwner = async (canvasId: string): Promise<string | null> => {
    const canvas = await lookup.getCanvas(canvasId);
    if (
      !canvas ||
      canvas.workspaceId !== input.workspaceId ||
      canvas.channelId !== input.channelId ||
      !canvas.artifactType
    ) {
      return null;
    }
    return canvas.id;
  };

  const ticketOwner = async (ticketId: string): Promise<string | null> => {
    const ticket = await lookup.getTicket(ticketId);
    if (
      !ticket ||
      ticket.workspaceId !== input.workspaceId ||
      ticket.channelId !== input.channelId
    ) {
      return null;
    }
    const link = await lookup.findLinkSource({
      repoId: input.repoId,
      targetType: 'TICKET',
      targetId: ticket.id,
      relationType: 'TICKET',
    });
    return link?.sourceType === 'CANVAS' ? canvasOwner(link.sourceId) : null;
  };

  if (input.surfaceType === 'CANVAS') return canvasOwner(input.surfaceId);
  if (input.surfaceType === 'TICKET') return ticketOwner(input.surfaceId);

  const pullRequest = await lookup.getPullRequest(input.surfaceId);
  if (!pullRequest || pullRequest.workspaceId !== input.workspaceId) return null;
  const pullRequestLink = await lookup.findLinkSource({
    repoId: input.repoId,
    targetType: 'PULL_REQUEST',
    targetId: pullRequest.id,
    relationType: 'PULL_REQUEST',
  });
  return pullRequestLink?.sourceType === 'TICKET' ? ticketOwner(pullRequestLink.sourceId) : null;
}
