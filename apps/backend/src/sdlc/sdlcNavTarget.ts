import { ChannelType } from '@xyne/shared';
import { sdlcSectionForCanvas, type SdlcNavTarget, type SdlcSection } from '@xyne/shared/sdlc';
import { db } from '@/database/client';
import { runAsSystem } from '@/database/tenant/context';
import { resolveInheritedOwner } from './entityLinkService';

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

/** Raised once per recipient, so a 200-member hub would otherwise pay 200 identical lookups. */
const TTL_MS = 60_000;
const MAX_ENTRIES = 5_000;

/**
 * Keyed on the entity id alone, so every load runs as system: under a caller's own
 * scope the same id answers differently per user, and one of those answers would be
 * served to everyone. A null is dropped rather than cached — it usually means a row
 * that has not been written yet, and a write-time stamp is permanent.
 */
function memoize<A, T>(
  keyOf: (arg: A) => string,
  load: (arg: A) => Promise<T>,
): (arg: A) => Promise<T> {
  const entries = new Map<string, { at: number; value: Promise<T> }>();
  return arg => {
    const key = keyOf(arg);
    const hit = entries.get(key);
    if (hit && Date.now() - hit.at <= TTL_MS) return hit.value;
    if (entries.size >= MAX_ENTRIES) entries.clear();
    const value = runAsSystem(() => load(arg)).then(
      resolved => {
        if (resolved == null) entries.delete(key);
        return resolved;
      },
      (error: unknown) => {
        entries.delete(key);
        throw error;
      },
    );
    entries.set(key, { at: Date.now(), value });
    return value;
  };
}

interface CanvasInfo {
  channelId: string | null;
  section: SdlcSection;
  folderId?: string;
}

export const isSdlcChannel = memoize(
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
  (conversationId: string) => conversationId,
  (conversationId: string) => resolveInheritedOwner(db, conversationId),
);

export const sdlcConversationTicket = memoize(
  (conversationId: string) => conversationId,
  async (conversationId: string): Promise<string | null> =>
    (await db.ticket.findFirst({ where: { conversationId }, select: { id: true } }))?.id ?? null,
);

export const sdlcTicketConversation = memoize(
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
  const canvas = await canvasLocation(owner.sourceId);
  return canvas ? { ...canvas, discussionId: conversationId } : null;
}

async function ticketLocation(ticketId: string): Promise<SdlcLocation> {
  const conversationId = await sdlcTicketConversation(ticketId);
  const owned = conversationId ? await conversationLocation(conversationId) : null;
  return owned ?? { section: 'tickets', ticketId };
}

const locationOf = memoize(
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

/** Where a notification opens in an SDLC hub. Null for everything outside one. */
export async function resolveSdlcNavTarget(ids: SdlcNavIds): Promise<SdlcNavTarget | null> {
  const channelId = await resolveChannelId(ids);
  if (!channelId || !(await isSdlcChannel(channelId))) return null;

  const place: SdlcLocation = (await locationOf(ids)) ?? { section: 'overview' };

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
