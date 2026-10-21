import type { Request, RequestHandler } from 'express';
import { OrgRole, WorkspaceRole, db } from '../../../re-exports';
import { GatewayError } from '../../../core/errors';
import { asyncRoute } from '../../../core/middleware/errorHandler';
import { PairRepository } from '../../../core/repositories/pairRepository';
import { SyncRequestRepository } from '../repositories/syncRequestRepository';
import { MIRROR_SOURCE_SUFFIX } from '../types';

type ChannelOf = (req: Request) => Promise<string | undefined>;

const links = new PairRepository(MIRROR_SOURCE_SUFFIX);
const requests = new SyncRequestRepository();

/** Workspace or organisation admins and owners, the same people `requireAdminOrOwner` lets in. */
export function isOrgAdmin(user: NonNullable<Request['user']>): boolean {
  return (
    user.role === WorkspaceRole.ADMIN ||
    user.role === WorkspaceRole.OWNER ||
    user.orgRole === OrgRole.ADMIN ||
    user.orgRole === OrgRole.OWNER
  );
}

const fromBodyOrQuery: ChannelOf = async (req) => {
  if (typeof req.body?.spacesChannelId === 'string') return req.body.spacesChannelId;
  return typeof req.query.channelId === 'string' ? req.query.channelId : undefined;
};

const fromLink: ChannelOf = async (req) => {
  const link = await links.findById(req.params.id);
  if (!link) throw new GatewayError('LINK_NOT_FOUND', 'Link not found');
  return link.spacesId;
};

const fromRequest: ChannelOf = async (req) => {
  const request = await requests.findById(req.params.id);
  if (!request) throw new GatewayError('REQUEST_NOT_FOUND', 'Request not found');
  return request.spacesId;
};

/** Syncing shares a channel's messages with the provider, so its admins decide; services check the workspace. */
function channelGuard(
  channelOf: ChannelOf,
  role: 'MEMBER' | 'ADMIN',
  allowOrgAdmin = false
): RequestHandler {
  return asyncRoute(async (req, _res, next) => {
    const channelId = await channelOf(req);
    if (!channelId) throw new GatewayError('VALIDATION_ERROR', 'channelId is required');
    if (allowOrgAdmin && isOrgAdmin(req.user!)) return next();

    const participant = await db.channelParticipant.findUnique({
      where: { channelId_userId: { channelId, userId: req.user!.id } },
      select: { role: true },
    });
    if (!participant)
      throw new GatewayError('NOT_CHANNEL_MEMBER', 'Only channel members can see its sync');
    if (role === 'ADMIN' && participant.role !== 'ADMIN') {
      throw new GatewayError('NOT_CHANNEL_ADMIN', 'Only channel admins can manage its sync');
    }
    next();
  });
}

export const requireChannelMember: RequestHandler = channelGuard(fromBodyOrQuery, 'MEMBER');
export const requireChannelAdmin: RequestHandler = channelGuard(fromBodyOrQuery, 'ADMIN');
export const requireRequestChannelAdmin: RequestHandler = channelGuard(fromRequest, 'ADMIN');
export const requireLinkManager: RequestHandler = channelGuard(fromLink, 'ADMIN', true);
