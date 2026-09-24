import { ChannelType } from '@xyne/shared';
import { sdlcSectionForCanvas, type SdlcNavTarget, type SdlcSection } from '@xyne/shared/sdlc';
import { db } from '@/database/client';
import { memoizeAsSystem as memoize } from '@/bypassAcl/tenantUtils';
import { isTrackReachableInChannel, ticketChannelIdForNavTarget } from '@/bypassAcl/sdlcServices';
import { resolveFolderTrackId, resolveItemTrackId, resolveInheritedOwner } from './entityLinkService';

export interface SdlcNavIds {
  channelId?: string | null;
  canvasId?: string | null;
  ticketId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  blockId?: string | null;
  commentThreadId?: string | null;
}

interface SdlcLocation {
  section: SdlcSection;
  canvasId?: string;
  folderId?: string;
  trackId?: string;
  ticketId?: string;
  discussionId?: string;
}

interface CanvasInfo {
  channelId: string | null;
  section: SdlcSection;
  folderId?: string;
}

export const isSdlcChannel = memoize(
  ['Channel'],
  'keyed on entity id alone — same id must answer identically for every caller, not per-user',
  (channelId: string) => channelId,
  async (channelId: string): Promise<boolean> => {
    const channel = await db.channel.findUnique({
      where: { id: channelId },
      select: { type: true },
    });
    return channel?.type === ChannelType.SDLC;
  },
);

const canvasInfo = memoize(
  ['Canvas'],
  'keyed on entity id alone — same id must answer identically for every caller, not per-user',
  (canvasId: string) => canvasId,
  async (canvasId: string): Promise<CanvasInfo | null> => {
    const canvas = await db.canvas.findUnique({
      where: { id: canvasId },
      select: { channelId: true, folderId: true, sdlcArtifact: { select: { artifactType: true } } },
    });
    if (!canvas) return null;
    return {
      channelId: canvas.channelId,
      ...sdlcSectionForCanvas(canvas.sdlcArtifact?.artifactType, canvas.folderId),
    };
  },
);

async function canvasLocation(canvasId: string): Promise<SdlcLocation | null> {
  const info = await canvasInfo(canvasId);
  return info
    ? { section: info.section, canvasId, ...(info.folderId ? { folderId: info.folderId } : {}) }
    : null;
}

export const sdlcConversationOwner = memoize(
  ['SdlcEntityLink'],
  'keyed on entity id alone — same id must answer identically for every caller, not per-user',
  (conversationId: string) => conversationId,
  (conversationId: string) => resolveInheritedOwner(db, conversationId),
);

export const sdlcFolderTrackId = memoize(
  ['SdlcEntityLink'],
  'keyed on entity id alone — same id must answer identically for every caller, not per-user',
  (folderId: string) => folderId,
  (folderId: string) => resolveFolderTrackId(db, folderId),
);

export const sdlcConversationTicket = memoize(
  ['Ticket'],
  'keyed on entity id alone — same id must answer identically for every caller, not per-user',
  (conversationId: string) => conversationId,
  async (conversationId: string): Promise<string | null> =>
    (await db.ticket.findFirst({ where: { conversationId }, select: { id: true } }))?.id ?? null,
);

export const sdlcTicketConversation = memoize(
  ['Ticket'],
  'keyed on entity id alone — same id must answer identically for every caller, not per-user',
  (ticketId: string) => ticketId,
  async (ticketId: string): Promise<string | null> =>
    (await db.ticket.findUnique({ where: { id: ticketId }, select: { conversationId: true } }))
      ?.conversationId ?? null,
);

async function conversationLocation(conversationId: string): Promise<SdlcLocation | null> {
  const owner = await sdlcConversationOwner(conversationId);
  if (!owner) {
    const ticketId = await sdlcConversationTicket(conversationId);
    return ticketId ? { section: 'tickets', ticketId } : null;
  }
  if (owner.sourceType === 'TRACK') {
    return { section: 'tracks', trackId: owner.sourceId, discussionId: conversationId };
  }
  // A folder, an uploaded file and a link have no page of their own; their
  // conversations are read from the track they are filed in.
  if (
    owner.sourceType === 'FOLDER' ||
    owner.sourceType === 'ATTACHMENT' ||
    owner.sourceType === 'LINK'
  ) {
    const trackId = await resolveItemTrackId(db, owner.sourceType, owner.sourceId);
    return trackId ? { section: 'tracks', trackId, discussionId: conversationId } : null;
  }
  const canvas = await canvasLocation(owner.sourceId);
  return canvas ? { ...canvas, discussionId: conversationId } : null;
}

async function ticketLocation(ticketId: string): Promise<SdlcLocation> {
  const conversationId = await sdlcTicketConversation(ticketId);
  const owned = conversationId ? await conversationLocation(conversationId) : null;
  return owned ?? { section: 'tickets', ticketId };
}

const locationOf = memoize(
  ['Canvas', 'SdlcEntityLink', 'Ticket'],
  'composes canvasLocation/conversationLocation/ticketLocation, keyed on entity id alone',
  (ids: SdlcNavIds) =>
    `${ids.canvasId ?? ''}|${ids.ticketId ?? ''}|${ids.conversationId ?? ''}`,
  async (ids: SdlcNavIds): Promise<SdlcLocation | null> =>
    ids.canvasId
      ? canvasLocation(ids.canvasId)
      : ids.conversationId
        ? conversationLocation(ids.conversationId)
        : ids.ticketId
          ? ticketLocation(ids.ticketId)
          : null,
);

/** Canvas sharing sends no channelId, so it is derived rather than fixed builder by builder. */
async function resolveChannelId(ids: SdlcNavIds): Promise<string | null> {
  if (ids.channelId) return ids.channelId;
  if (ids.canvasId) return (await canvasInfo(ids.canvasId))?.channelId ?? null;
  if (ids.ticketId) {
    const ticket = await db.ticket.findUnique({
      where: { id: ids.ticketId },
      select: { channelId: true },
    });
    return ticket?.channelId ?? null;
  }
  return null;
}

/**
 * Whether a resolved place belongs to the hub the caller named. Conversation ids
 * leave their hub on every forward, so a caller-supplied channelId says which hub
 * is authorized, never which hub the ids came from. Uncached: entity -> hub is
 * memoized above, the match is per call.
 */
async function placeInChannel(place: SdlcLocation, channelId: string): Promise<boolean> {
  const { canvasId, trackId, ticketId } = place;
  if (canvasId) return (await canvasInfo(canvasId))?.channelId === channelId;
  if (trackId) return isTrackReachableInChannel(trackId, channelId);
  if (ticketId) {
    const ticket = await ticketChannelIdForNavTarget(ticketId);
    return ticket?.channelId === channelId;
  }
  return true;
}

/** Where a notification opens in an SDLC hub. Null for everything outside one. */
export async function resolveSdlcNavTarget(ids: SdlcNavIds): Promise<SdlcNavTarget | null> {
  const channelId = await resolveChannelId(ids);
  if (!channelId || !(await isSdlcChannel(channelId))) return null;

  const place: SdlcLocation = (await locationOf(ids)) ?? { section: 'overview' };
  if (!(await placeInChannel(place, channelId))) return null;

  const conversationId =
    place.discussionId ?? (ids.messageId && ids.conversationId ? ids.conversationId : undefined);

  return {
    channelId,
    section: place.section,
    ...(place.canvasId ? { canvasId: place.canvasId } : {}),
    ...(place.folderId ? { folderId: place.folderId } : {}),
    ...(place.trackId ? { trackId: place.trackId } : {}),
    ...(place.ticketId ? { ticketId: place.ticketId } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(ids.messageId ? { messageId: ids.messageId } : {}),
    ...(ids.blockId ? { blockId: ids.blockId } : {}),
    ...(ids.commentThreadId ? { commentThreadId: ids.commentThreadId } : {}),
  };
}
