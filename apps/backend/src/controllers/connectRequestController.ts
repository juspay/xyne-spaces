/**
 * Slack-Connect — connect_request invite/approval handshake (Phase 9).
 * REST only (the table is non_zero). Both admin gates are mandatory.
 */
import { Request, Response } from 'express';
import { connectRequestService } from '@/services/connectRequestService';
import { connectChannelService } from '@/services/connectChannelService';
import { db } from '@/database/client';
import { runAsSystem } from '@/database/tenant/context';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import type { ConnectRequest } from '@prisma/client';

function isAdminOrOwner(role?: string, orgRole?: string): boolean {
  return role === 'ADMIN' || role === 'OWNER' || orgRole === 'ADMIN' || orgRole === 'OWNER';
}

/** Public-safe projection of a connect_request row for the inbox/outbox UIs. */
function toDto(r: ConnectRequest) {
  return {
    id: r.id,
    entityId: r.entityId,
    entityType: r.entityType,
    hostWorkspaceId: r.hostWorkspaceId,
    guestWorkspaceId: r.guestWorkspaceId,
    inviteEmail: r.inviteEmail,
    status: r.status,
    invitedBy: r.invitedBy,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
  };
}

export class ConnectRequestController {
  /** POST /api/connect-requests — host participant invites an external user by email. */
  invite = async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId, email } = req.body as { channelId?: string; email?: string };
      const user = req.user;
      if (!user) { res.status(401).json({ error: 'Unauthorized' }); return; }
      if (!channelId || !email) { res.status(400).json({ error: 'channelId and email are required' }); return; }

      const request = await connectRequestService.invite({
        entityId: channelId,
        inviterUserId: user.id,
        inviterWorkspaceId: user.workspaceId,
        inviteEmail: email,
      });
      res.status(201).json({ request: toDto(request) });
    } catch (error) {
      this.fail(res, error, 'invite');
    }
  };

  /** GET /api/connect-requests/channel/:channelId — pending invites for a channel (creator/admin/participant). */
  listForChannel = async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId } = req.params;
      const user = req.user;
      if (!user) { res.status(401).json({ error: 'Unauthorized' }); return; }
      // Must be a participant of the (host) channel in the caller's workspace.
      const participant = await runAsSystem(async () => {
        return await db.channelParticipant.findUnique({
          where: { channelId_userId: { channelId, userId: user.id } },
          select: { id: true },
        });
      });
      if (!participant) { res.status(403).json({ error: 'Not a participant of this channel' }); return; }
      const requests = await connectRequestService.listByEntity(channelId);
      res.status(200).json({ requests: requests.map(toDto) });
    } catch (error) {
      this.fail(res, error, 'listForChannel');
    }
  };

  /** POST /api/connect-requests/:id/host-approve — host admin approves; returns the invite link (dev). */
  hostApprove = async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user;
      if (!user) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const request = await connectRequestService.findById(req.params.id);
      if (!request) { res.status(404).json({ error: 'Invitation not found' }); return; }
      if (user.workspaceId !== request.hostWorkspaceId || !isAdminOrOwner(user.role, user.orgRole)) {
        res.status(403).json({ error: 'Only a host-workspace admin can approve this request' });
        return;
      }
      const updated = await connectRequestService.hostAdminApprove(request.id, user.id);
      const inviteLink = this.buildConnectAcceptLink(req, updated.inviteToken);
      if (config.env === 'development') {
        // Dev: skip email, log + return the link so it can be opened directly.
        logger.info(`[ConnectRequest] DEV — invite link for ${updated.inviteEmail}: ${inviteLink}`);
      } else {
        const emailResult = await connectRequestService.sendHostApprovedInviteEmail(updated, inviteLink);
        if (!emailResult.success) {
          await connectRequestService.revertHostApprove(updated.id);
          throw new Error(`Failed to send connect invitation email: ${emailResult.error}`);
        }
      }
      res.status(200).json({
        request: toDto(updated),
        ...(config.env === 'development' ? { inviteLink } : {}),
      });
    } catch (error) {
      this.fail(res, error, 'hostApprove');
    }
  };

  /** POST /api/connect-requests/:id/guest-approve — guest admin approves → ACTIVE + materialize. */
  guestApprove = async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user;
      if (!user) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const request = await connectRequestService.findById(req.params.id);
      if (!request) { res.status(404).json({ error: 'Invitation not found' }); return; }
      if (user.workspaceId !== request.guestWorkspaceId || !isAdminOrOwner(user.role, user.orgRole)) {
        res.status(403).json({ error: 'Only a guest-workspace admin can approve this request' });
        return;
      }
      const updated = await connectRequestService.guestAdminApprove(request.id, user.id);
      res.status(200).json({ request: toDto(updated) });
    } catch (error) {
      this.fail(res, error, 'guestApprove');
    }
  };

  /** POST /api/connect-requests/:id/reject — host admin/inviter (while pending) or guest admin. */
  reject = async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user;
      if (!user) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const request = await connectRequestService.findById(req.params.id);
      if (!request) { res.status(404).json({ error: 'Invitation not found' }); return; }
      const isHostSide =
        user.workspaceId === request.hostWorkspaceId &&
        (isAdminOrOwner(user.role, user.orgRole) || user.id === request.invitedBy);
      const isGuestSide =
        !!request.guestWorkspaceId &&
        user.workspaceId === request.guestWorkspaceId &&
        isAdminOrOwner(user.role, user.orgRole);
      if (!isHostSide && !isGuestSide) {
        res.status(403).json({ error: 'You are not allowed to reject this request' });
        return;
      }
      const updated = await connectRequestService.reject(request.id, user.id);
      res.status(200).json({ request: toDto(updated) });
    } catch (error) {
      this.fail(res, error, 'reject');
    }
  };

  /** GET /api/connect-requests/:token/verify — public: entity + host workspace info for the accept page. */
  verify = async (req: Request, res: Response): Promise<void> => {
    try {
      const info = await connectRequestService.verify(req.params.token);
      res.status(200).json(info);
    } catch (error) {
      this.fail(res, error, 'verify');
    }
  };

  /** POST /api/connect-requests/:token/accept — invitee accepts, picks a workspace + channel config. */
  accept = async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user;
      if (!user) { res.status(401).json({ error: 'Please sign in to accept this invitation' }); return; }
      const { guestWorkspaceId, channelName, visibility } = req.body as {
        guestWorkspaceId?: string;
        channelName?: string;
        visibility?: 'PUBLIC' | 'PRIVATE';
      };
      if (!guestWorkspaceId) { res.status(400).json({ error: 'guestWorkspaceId is required' }); return; }

      const updated = await connectRequestService.guestAccept({
        token: req.params.token,
        guestUserId: user.id,
        guestEmail: user.email,
        guestWorkspaceId,
        guestEntityConfig: { name: channelName, visibility },
      });
      res.status(200).json({ request: toDto(updated) });
    } catch (error) {
      this.fail(res, error, 'accept');
    }
  };

  /** GET /api/connect-requests/outbox — host-admin outbox (pending host-admin approvals). */
  outbox = async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user;
      if (!user || !isAdminOrOwner(user.role, user.orgRole)) {
        res.status(403).json({ error: 'Admins only' }); return;
      }
      const requests = await connectRequestService.listHostOutbox(user.workspaceId);
      res.status(200).json({ requests: requests.map(toDto) });
    } catch (error) {
      this.fail(res, error, 'outbox');
    }
  };

  /** GET /api/connect-requests/inbox — guest-admin inbox (pending guest-admin approvals). */
  inbox = async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user;
      if (!user || !isAdminOrOwner(user.role, user.orgRole)) {
        res.status(403).json({ error: 'Admins only' }); return;
      }
      const requests = await connectRequestService.listGuestAdminInbox(user.workspaceId);
      res.status(200).json({ requests: requests.map(toDto) });
    } catch (error) {
      this.fail(res, error, 'inbox');
    }
  };

  // ── channel connect toggle (enable/disable/can-disable) ─────────────────────

  private async assertChannelCreatorOrAdmin(req: Request, channelId: string): Promise<boolean> {
    const user = req.user!;
    const channel = await runAsSystem(async () => {
      return await db.channel.findUnique({ where: { id: channelId }, select: { workspaceId: true, createdBy: true } });
    });
    if (!channel || channel.workspaceId !== user.workspaceId) return false;
    return channel.createdBy === user.id || isAdminOrOwner(user.role, user.orgRole);
  }

  enableConnect = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const { channelId } = req.params;
      if (!(await this.assertChannelCreatorOrAdmin(req, channelId))) {
        res.status(403).json({ error: 'Only the channel creator or a workspace admin can do this' });
        return;
      }
      await connectChannelService.enableConnect(channelId);
      res.status(200).json({ channelId, isConnectEnabled: true });
    } catch (error) {
      this.fail(res, error, 'enableConnect');
    }
  };

  disableConnect = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const { channelId } = req.params;
      if (!(await this.assertChannelCreatorOrAdmin(req, channelId))) {
        res.status(403).json({ error: 'Only the channel creator or a workspace admin can do this' });
        return;
      }
      await connectChannelService.disableConnect(channelId); // throws if any org is connected
      res.status(200).json({ channelId, isConnectEnabled: false });
    } catch (error) {
      this.fail(res, error, 'disableConnect');
    }
  };

  canDisableConnect = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const canDisable = await connectChannelService.canDisableConnect(req.params.channelId);
      res.status(200).json({ canDisable });
    } catch (error) {
      this.fail(res, error, 'canDisableConnect');
    }
  };

  // ── helpers ─────────────────────────────────────────────────────────────────

  private buildConnectAcceptLink(req: Request, token: string): string {
    const origin = (req.headers.origin as string | undefined)?.replace(/\/$/, '');
    const base = origin || config.slackFrontendUrl.replace(/\/$/, '');
    return `${base}/connect-invite?token=${encodeURIComponent(token)}`;
  }

  private fail(res: Response, error: unknown, where: string): void {
    logger.error(`[ConnectRequestController] ${where} failed:`, error);
    const message = error instanceof Error ? error.message : 'Request failed';
    res.status(400).json({ error: message });
  }
}

export const connectRequestController = new ConnectRequestController();
