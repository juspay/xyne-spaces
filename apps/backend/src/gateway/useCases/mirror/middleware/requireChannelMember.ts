import type { Request, RequestHandler } from 'express';
import { db } from '../../../re-exports';
import { GatewayError } from '../../../core/errors';
import { PairRepository } from '../../../core/repositories/pairRepository';
import { asyncRoute } from '../../../core/middleware/errorHandler';
import { MIRROR_SOURCE_SUFFIX } from '../types';

const links = new PairRepository(MIRROR_SOURCE_SUFFIX);

/** The Spaces channel a /links request acts on: the link's own, the body's, or ?channelId=. */
async function channelIdOf(req: Request): Promise<string | undefined> {
  if (req.params.id) {
    const link = await links.findById(req.params.id);
    if (!link) throw new GatewayError('LINK_NOT_FOUND', 'Link not found');
    return link.spacesId;
  }
  const fromBody =
    typeof req.body?.spacesChannelId === 'string' ? req.body.spacesChannelId : undefined;
  const fromQuery = typeof req.query.channelId === 'string' ? req.query.channelId : undefined;
  return fromBody ?? fromQuery;
}

/** Linking sends a channel's messages to the provider, so only people in that channel may manage it. */
export const requireChannelMember: RequestHandler = asyncRoute(async (req, _res, next) => {
  const channelId = await channelIdOf(req);
  if (!channelId) throw new GatewayError('VALIDATION_ERROR', 'channelId is required');

  const participant = await db.channelParticipant.findUnique({
    where: { channelId_userId: { channelId, userId: req.user!.id } },
    select: { id: true },
  });
  if (!participant)
    throw new GatewayError('NOT_CHANNEL_MEMBER', 'Only channel members can manage its sync');
  next();
});
