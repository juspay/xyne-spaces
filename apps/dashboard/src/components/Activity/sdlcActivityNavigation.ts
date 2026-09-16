import { buildSdlcPath, sdlcSectionForCanvas, type SdlcNavTarget } from '@xyne/shared/sdlc';

interface SdlcCanvas {
  readonly id: string;
  readonly folderId?: string | null;
  readonly sdlcArtifact?: { readonly artifactType?: string | null } | null;
}
interface SdlcActivity {
  readonly channelId?: string | null;
  readonly canvas?: SdlcCanvas | null;
  readonly canvasId?: string | null;
  readonly trackId?: string | null;
  readonly ticketId?: string | null;
  readonly conversationId?: string | null;
  readonly messageId?: string | null;
  readonly blockId?: string | null;
  readonly actionSource?: string | null;
  readonly actionSourceId?: string | null;
}

/** SDLC's row-to-path rule. The owner is stamped at write time, so nothing is fetched. */
export function resolveSdlcActivityTarget(input: {
  activity: SdlcActivity;
  channelType: string | null | undefined;
  fallbackPath: string;
}): string {
  const { activity } = input;
  const channelId = activity.channelId;
  if (input.channelType !== 'SDLC' || !channelId) return input.fallbackPath;

  const conversationId = activity.conversationId ?? undefined;
  const canvas = activity.canvas;
  // Only a conversation with no owner is left to the ticket's own page.
  const place: Partial<SdlcNavTarget> = activity.canvasId
    ? {
        ...sdlcSectionForCanvas(canvas?.sdlcArtifact?.artifactType, canvas?.folderId),
        canvasId: activity.canvasId,
        conversationId,
      }
    : activity.trackId
      ? { section: 'tracks', trackId: activity.trackId, conversationId }
      : activity.ticketId
        ? // conversationId is only the scroll anchor here; the page has no panel.
          { section: 'tickets', ticketId: activity.ticketId, conversationId }
        : { section: 'overview' };

  // A canvas comment mention files the thread id in actionSourceId.
  const commentThreadId =
    activity.actionSource === 'canvas_comment' && activity.actionSourceId !== activity.canvasId
      ? activity.actionSourceId
      : undefined;

  return buildSdlcPath({
    ...place,
    section: place.section ?? 'overview',
    channelId,
    ...(activity.messageId ? { messageId: activity.messageId } : {}),
    ...(activity.blockId ? { blockId: activity.blockId } : {}),
    ...(commentThreadId ? { commentThreadId } : {}),
  });
}
