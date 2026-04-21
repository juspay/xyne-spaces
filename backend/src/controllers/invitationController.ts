/**
 * Invitation Controller
 * Handles HTTP requests for invitation operations
 */

import { Request, Response } from 'express';
import { ProjectType, Status } from '@prisma/client';
import { invitationService } from '@/services/invitationService';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';

export class InvitationController {
  /**
   * POST /api/invitations
   * Create a new invitation
   */
  createInvitation = async (req: Request, res: Response): Promise<void> => {
    let invitation = null;

    try {
      const { email, role, workspaceId } = req.body;
      const invitedBy = req.user?.id;

      if (!invitedBy) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Validate required fields
      if (!email || typeof email !== 'string') {
        res.status(400).json({ error: 'Email is required' });
        return;
      }

      if (!workspaceId || typeof workspaceId !== 'string') {
        res.status(400).json({ error: 'Workspace ID is required' });
        return;
      }

      // Create the invitation (includes workspace data)
      invitation = await invitationService.createInvitation({
        email: email.trim().toLowerCase(),
        role,
        workspaceId,
        invitedBy,
      });

      // Send invitation email
      const emailResult = await invitationService.sendInvitationEmail({
        to: email,
        inviterName: req.user?.name || 'A team member',
        workspaceName: invitation.workspace?.name || 'the workspace',
        invitationLink: `${config.frontendUrl}/invite?workspaceId=${workspaceId}&invitationId=${invitation.invitationId || invitation.id}`,
        invitationId: invitation.invitationId || invitation.id,
      });

      // If email failed, delete the invitation to maintain consistency
      if (!emailResult.success) {
        await invitationService.deleteInvitation(invitation.id);
        invitation = null; // Prevent double-delete in catch block
        throw new Error(`Failed to send invitation email: ${emailResult.error}`);
      }

      res.status(201).json({
        success: true,
        invitation: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          workspaceId: invitation.workspaceId,
          invitedAt: invitation.invitedAt,
        },
      });
    } catch (error) {
      // Clean up invitation if it was created but something went wrong
      if (invitation) {
        try {
          await invitationService.deleteInvitation(invitation.id);
        } catch (deleteError) {
          logger.error('[InvitationController] Failed to clean up invitation after error:', deleteError);
        }
      }

      logger.error('[InvitationController] Failed to create invitation:', error);

      if (error instanceof Error) {
        if (error.message.includes('already exists')) {
          res.status(409).json({ error: error.message });
          return;
        }
        res.status(400).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to create invitation' });
    }
  };

  /**
   * GET /api/invitations/:id/verify
   * Verify if an invitation is valid (not expired/revoked)
   * Public endpoint - no authentication required
   */
  verifyInvitation = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({ error: 'Invitation ID is required' });
        return;
      }

      // Look up by invitationId (public token), not internal id
      const invitation = await invitationService.getInvitationByInvitationId(id);

      // Check if invitation exists
      if (!invitation) {
        res.status(404).json({
          valid: false,
          error: 'Invitation not found',
        });
        return;
      }

      // Check if invitation is already accepted
      if (invitation.acceptedAt) {
        res.status(410).json({
          valid: false,
          error: 'Invitation has already been accepted',
          acceptedAt: invitation.acceptedAt,
        });
        return;
      }

      // Check if invitation is expired
      if (invitation.expiredAt && new Date(invitation.expiredAt) < new Date()) {
        res.status(410).json({
          valid: false,
          error: 'Invitation has expired',
          expiredAt: invitation.expiredAt,
        });
        return;
      }

      // Invitation is valid
      res.status(200).json({
        valid: true,
        invitation: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          workspaceName: invitation.workspace?.name,
          organizationName: invitation.organization?.name,
        },
      });
    } catch (error) {
      logger.error('[InvitationController] Failed to verify invitation:', error);
      res.status(500).json({ error: 'Failed to verify invitation' });
    }
  };

  /**
   * POST /api/invitations/:id/accept
   * Accept an invitation — identity is taken from the google_access_token cookie
   * (set by handleCallback after OAuth login), NOT from a session JWT.
   */
  acceptInvitation = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({ error: 'Invitation ID is required' });
        return;
      }

      // Read identity from the httpOnly google_access_token cookie
      const pendingAuthRaw = req.cookies?.google_access_token as string | undefined;
      if (!pendingAuthRaw) {
        res.status(401).json({ error: 'Not authenticated. Please login first.' });
        return;
      }

      let pendingAuth: {
        user: { email: string; googleId: string; name: string; picture?: string };
        provider: string;
        refreshToken: string | null;
        accessToken: string | null;
      };

      try {
        pendingAuth = JSON.parse(pendingAuthRaw) as typeof pendingAuth;
      } catch {
        res.status(401).json({ error: 'Invalid authentication session. Please login again.' });
        return;
      }

      const { user: googleUser } = pendingAuth;

      // Fetch invitation to verify email before accepting
      const invitation = await invitationService.getInvitationByInvitationId(id);
      if (!invitation) {
        res.status(404).json({ error: 'Invitation not found' });
        return;
      }

      if (invitation.email.toLowerCase() !== googleUser.email.toLowerCase()) {
        res.status(403).json({
          error: `This invitation is for ${invitation.email}, but you are logged in as ${googleUser.email}.`,
        });
        return;
      }

      await invitationService.acceptInvitation({
        invitationId: id,
        userData: {
          id: googleUser.googleId,
          email: googleUser.email,
          name: googleUser.name,
          providerUserId: googleUser.googleId,
          authProvider: 'GOOGLE',
        },
      });

      res.status(200).json({
        success: true,
        workspaceId: invitation.workspaceId,
        email: googleUser.email,
        name: googleUser.name,
        picture: googleUser.picture ?? '',
      });
    } catch (error) {
      logger.error('[InvitationController] Failed to accept invitation:', error);

      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to accept invitation' });
    }
  };
  /**
   * POST /api/invitations/provision-org
   * Admin action: create a new org + workspace, add an owner by email, and send them an invitation.
   * All DB operations run in a single Prisma transaction for clean rollback on failure.
   */
  provisionOrg = async (req: Request, res: Response): Promise<void> => {
    let invitationId: string | null = null;

    try {
      const { orgName, workspaceName, ownerEmail } = req.body as {
        orgName?: string;
        workspaceName?: string;
        ownerEmail?: string;
      };

      if (!orgName?.trim() || !workspaceName?.trim() || !ownerEmail?.trim()) {
        res.status(400).json({ error: 'orgName, workspaceName, and ownerEmail are required' });
        return;
      }

      const invitedBy = req.user!.id;
      const prisma = DatabaseClient.getInstance();

      // Reject if the owner email is already an active member of any org
      const existingMembership = await prisma.orgMember.findFirst({
        where: { email: ownerEmail.trim().toLowerCase(), leftAt: null },
        select: { orgId: true },
      });
      if (existingMembership) {
        res.status(409).json({
          error: `${ownerEmail.trim()} is already a member of an organisation`,
        });
        return;
      }

      // All creation steps in one transaction — rollback automatically on any failure
      const { org, workspace } = await prisma.$transaction(async tx => {
        const org = await tx.organization.create({
          data: {
            name: orgName.trim(),
            createdBy: invitedBy,
            status: Status.ACTIVE,
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            orgId: org.orgId,
            name: workspaceName.trim(),
            createdBy: invitedBy,
            status: Status.ACTIVE,
          },
        });

        // DM project required for every workspace
        await tx.project.create({
          data: {
            name: 'Direct Messages',
            code: 'DM',
            description: 'DM project for direct message channels',
            type: ProjectType.DM,
            workspaceId: workspace.id,
            createdBy: invitedBy,
          },
        });

        // Link workspace ↔ org
        await tx.workspaceOrganization.create({
          data: {
            orgId: org.orgId,
            workspaceId: workspace.id,
            role: 'ADMIN',
          },
        });

        // Add owner as org_member (email-only — no User record yet)
        await tx.orgMember.create({
          data: {
            orgId: org.orgId,
            email: ownerEmail.trim().toLowerCase(),
            role: 'OWNER',
            invitedBy: req.user?.email ?? undefined,
          },
        });

        return { org, workspace };
      });

      // Sync all hardcoded bots into the newly provisioned workspace
      await unifiedBotUserService.syncAllBotUsers(workspace.id);

      // Create invitation outside the transaction (sends email — non-DB side-effect)
      const invitation = await invitationService.createInvitation({
        email: ownerEmail.trim().toLowerCase(),
        role: 'OWNER',
        workspaceId: workspace.id,
        orgId: org.orgId,
        invitedBy,
      });
      invitationId = invitation.invitationId ?? invitation.id;

      const emailResult = await invitationService.sendInvitationEmail({
        to: ownerEmail.trim().toLowerCase(),
        inviterName: req.user?.name ?? 'Administrator',
        workspaceName: workspaceName.trim(),
        invitationLink: `${config.frontendUrl}/invite?workspaceId=${workspace.id}&invitationId=${invitationId}`,
        invitationId,
      });

      if (!emailResult.success) {
        await invitationService.deleteInvitation(invitation.id);
        invitationId = null;
        throw new Error(`Failed to send invitation email: ${emailResult.error}`);
      }

      logger.info(`[InvitationController] Provisioned org=${org.orgId} workspace=${workspace.id} owner=${ownerEmail.trim()}`);

      res.status(201).json({
        success: true,
        orgId: org.orgId,
        workspaceId: workspace.id,
        invitationId,
      });
    } catch (error) {
      logger.error('[InvitationController] Failed to provision org:', error);

      if (error instanceof Error) {
        const status = error.message.includes('already exists') ? 409 : 400;
        res.status(status).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to provision organisation' });
    }
  };
}

export const invitationController = new InvitationController();
