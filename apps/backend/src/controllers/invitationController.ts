/**
 * Invitation Controller
 * Handles HTTP requests for invitation operations
 */

import jwt from 'jsonwebtoken';
import { Request, Response } from 'express';
import { invitationService } from '@/services/invitationService';
import { DatabaseClient } from '@/database/client';
import { withWorkspaceScope, runAsSystem } from '@/database/tenant/context';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';
import { WorkspaceJoinPolicy, WorkspaceType, ProjectType, Status, WorkspaceRole, OrgRole, InviteExperience } from '@xyne/shared';
import { aiProvisioningService } from '@/services/aiProvisioningService';
import { isOrganizationPolicyError, organizationDomainService } from '@/services/organizationDomainService';
import { CacConfigService } from '@/services/cacConfigService';
import { createCommunityWorkspaceDefaults } from '@/utils/communityWorkspaceDefaults';
import { getEncryptionProvider } from '@/services/encryption';

/**
 * Extract the hostname from an Origin header value.
 * e.g. "https://external.spaces.xyne.juspay.io" → "external.spaces.xyne.juspay.io"
 */
function extractDomainFromOrigin(origin: string): string | null {
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}

/**
 * Read the invite-onboarding mode out of a workspace's `metadata` JSON blob.
 * Stored there (rather than a dedicated column) so toggling it needs no migration.
 * Anything other than an explicit "BROWSER" — unset, malformed, or any other
 * value — resolves to the existing desktop-app-required flow.
 */
function resolveInviteExperience(metadata: unknown): InviteExperience {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const value = (metadata as Record<string, unknown>).inviteExperience;
    if (value === InviteExperience.BROWSER) return InviteExperience.BROWSER;
  }
  return InviteExperience.DESKTOP;
}

/**
 * Build an invitation link resolving the frontend URL via CAC per-domain.
 *
 * 1. Extract the domain from the request Origin header
 * 2. Look up `frontend_url` in CAC (Superposition) with { domain } context
 *    — this lets us map e.g. "spaces.xyne.juspay.net" → "https://app.spaces.xyne.juspay.net"
 * 3. If CAC has no override, use the Origin itself (for domains where origin = frontend)
 * 4. If no Origin, fall back to SLACK_FRONTEND_URL env
 */
export async function buildInvitationLink(params: {
  req: Request;
  workspaceId: string;
  invitationId: string;
  inviteExperience?: string | null;
}): Promise<string> {
  const { req, workspaceId, invitationId, inviteExperience } = params;
  const origin = req.headers.origin as string | undefined;
  const domain = origin ? extractDomainFromOrigin(origin) : null;

  let baseUrl: string;

  if (domain) {
    const cacUrl = await CacConfigService.fetch('frontend_url', { domain }) as string | null;
    baseUrl = (cacUrl || origin!).replace(/\/$/, '');
  } else {
    baseUrl = config.slackFrontendUrl.replace(/\/$/, '');
  }

  if (inviteExperience === InviteExperience.BROWSER) {
    return `${baseUrl}/invite?workspaceId=${workspaceId}&invitationId=${invitationId}`;
  }

  const path = `invite?workspaceId=${workspaceId}&invitationId=${invitationId}`;
  return `${baseUrl}/launch?path=${encodeURIComponent(path)}`;
}
import { createId } from '@paralleldrive/cuid2';

export class InvitationController {
  /**
   * POST /api/invitations
   * Create a new invitation
   */
  createInvitation = async (req: Request, res: Response): Promise<void> => {
    let invitation = null;

    try {
      const { email, role, workspaceId, entityId, entityType, channelId } = req.body;
      const invitedBy = req.user?.id;

      if (!invitedBy) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Only workspace admins/owners can send invitations
      const inviterRole = req.user?.role;
      if (inviterRole !== 'ADMIN' && inviterRole !== 'OWNER') {
        res.status(403).json({ error: 'Only workspace admins can send invitations' });
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

      // Authorization: the inviter must be an OWNER/ADMIN of the target workspace.
      // Prevents a plain MEMBER from minting invitations (incl. ADMIN roles) into a
      // workspace they do not administer. Role/workspace come from the authenticated
      // session (req.user), same as the admin gates in the auth middleware.
      if (req.user?.workspaceId !== workspaceId) {
        res.status(403).json({ error: 'Access denied - insufficient permissions' });
        return;
      }

      // Create the invitation (includes workspace data)
      invitation = await invitationService.createInvitation({
        email: email.trim().toLowerCase(),
        role,
        workspaceId,
        invitedBy,
        entityId,
        entityType,
        channelId,
      });

      const normalizedEmail = email.trim().toLowerCase();

      // Only generate a temp password for brand-new invitees with no existing workspace access.
      // Existing users may have already set their own password; overwriting it would be destructive.
      const existingWorkspaceUsers = await DatabaseClient.getInstance().user.count({
        where: { email: normalizedEmail, leftAt: null },
      });

      let tempPassword: string | null = null;
      if (existingWorkspaceUsers === 0 && role !== 'GUEST') {
        tempPassword = await invitationService.generateOrgMemberPassword(normalizedEmail);
      }

      const publicInvitationId = invitation.invitationId || invitation.id;
      const inviteExperience = resolveInviteExperience(invitation.workspace?.metadata);
      const invitationLink = await buildInvitationLink({
        req,
        workspaceId,
        invitationId: invitation.invitationId || invitation.id,
        inviteExperience,
      });

      if (config.env === 'development') {
        logger.info(`[InvitationController] DEV MODE — skipping email send. Invitation link for ${email}: ${invitationLink}`);
      } else {
        // Send invitation email
        const emailResult = await invitationService.sendInvitationEmail({
          to: email,
          inviterName: req.user?.name || 'A team member',
          workspaceName: invitation.workspace?.name || 'the workspace',
          invitationLink,
          invitationId: publicInvitationId,
          tempPassword: tempPassword ?? undefined,
          inviteExperience,
        });

        // If email failed, delete the invitation to maintain consistency
        if (!emailResult.success) {
          await invitationService.deleteInvitation(invitation.id);
          invitation = null; // Prevent double-delete in catch block
          throw new Error(`Failed to send invitation email: ${emailResult.error}`);
        }
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

      if (isOrganizationPolicyError(error)) {
        res.status(error.statusCode).json({
          error: error.message,
          code: error.code,
        });
        return;
      }

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

      // Build entity info
      let entityType: string | undefined;
      let entityId: string | undefined;
      let entityTitle: string | null = null;

      if (invitation.entityType && invitation.entityId) {
        entityType = invitation.entityType;
        entityId = invitation.entityId;

        const prisma = DatabaseClient.getInstance();
        if (invitation.entityType === 'CANVAS') {
          const canvas = await prisma.canvas.findUnique({
            where: { id: invitation.entityId },
            select: { title: true },
          });
          entityTitle = canvas?.title ?? null;
        } else if (invitation.entityType === 'CHANNEL') {
          const channel = await prisma.channel.findUnique({
            where: { id: invitation.entityId },
            select: { name: true },
          });
          entityTitle = channel?.name ?? null;
        } else if (invitation.entityType === 'PROJECT') {
          const project = await prisma.project.findUnique({
            where: { id: invitation.entityId },
            select: { name: true },
          });
          entityTitle = project?.name ?? null;
        }
      }

      // Invitation is valid
      const inviteExperience = resolveInviteExperience(invitation.workspace?.metadata);

      res.status(200).json({
        valid: true,
        invitation: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          workspaceName: invitation.workspace?.name,
          organizationName: invitation.organization?.name,
          entityType,
          entityId,
          entityTitle,
          inviteExperience,
        },
      });
    } catch (error) {
      logger.error('[InvitationController] Failed to verify invitation:', error);
      res.status(500).json({ error: 'Failed to verify invitation' });
    }
  };

  /**
   * POST /api/invitations/:id/accept
   * Accept an invitation — identity is taken from the oauth_token cookie
   * (set by OAuth handlers after login), NOT from a session JWT.
   */
  acceptInvitation = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({ error: 'Invitation ID is required' });
        return;
      }

      // Read identity from the httpOnly google_access_token cookie.
      // Supports both signed-JWT (new email/OAuth flows) and legacy JSON shapes.
      const pendingAuthRaw = req.cookies?.google_access_token as string | undefined;
      if (!pendingAuthRaw) {
        res.status(401).json({ error: 'Not authenticated. Please login first.' });
        return;
      }

      let oauthUser: { email: string; googleId?: string; providerUserId?: string; name: string; picture?: string };
      let provider: string;

      try {
        const decoded = jwt.verify(pendingAuthRaw, process.env.JWT_SECRET!) as {
          email?: string;
          name?: string;
          providerUserId?: string;
          picture?: string;
          googleId?: string;
          provider?: string;
          refreshToken?: string | null;
          accessToken?: string | null;
        };
        if (!decoded.email) throw new Error('Invalid JWT payload');


        oauthUser = {
          email: decoded.email,
          name: decoded.name || '',
          googleId: decoded.googleId,
          providerUserId: decoded.providerUserId,
          picture: decoded.picture || '',
        };
        provider = decoded.provider || 'GOOGLE';
      } catch {
        res.status(401).json({ error: 'Invalid authentication session. Please login again.' });
        return;
      }

      // Support both Google (googleId), Microsoft and Email (providerUserId)
      const providerUserId = oauthUser.googleId || oauthUser.providerUserId;
      if (!providerUserId) {
        res.status(401).json({ error: 'Invalid user data. Please login again.' });
        return;
      }

      // Normalize auth provider
      const normalizedProvider = provider?.toUpperCase();
      const authProvider = normalizedProvider === 'MICROSOFT'
        ? 'MICROSOFT'
        : normalizedProvider === 'EMAIL'
          ? 'EMAIL'
          : 'GOOGLE';

      // Fetch invitation to verify email before accepting
      const invitation = await invitationService.getInvitationByInvitationId(id);
      if (!invitation) {
        res.status(404).json({ error: 'Invitation not found' });
        return;
      }

      if (invitation.email.toLowerCase() !== oauthUser.email.toLowerCase()) {
        res.status(403).json({
          error: `This invitation is for ${invitation.email}, but you are logged in as ${oauthUser.email}.`,
        });
        return;
      }

      const { redirectPath } = await invitationService.acceptInvitation({
        invitationId: id,
        userData: {
          id: providerUserId,
          email: oauthUser.email,
          name: oauthUser.name,
          providerUserId: providerUserId,
          authProvider: authProvider,
        },
      });

      res.status(200).json({
        success: true,
        workspaceId: invitation.workspaceId,
        email: oauthUser.email,
        name: oauthUser.name,
        picture: oauthUser.picture ?? '',
        redirectPath,
      });
    } catch (error) {
      logger.error('[InvitationController] Failed to accept invitation:', error);

      if (isOrganizationPolicyError(error)) {
        res.status(error.statusCode).json({
          error: error.message,
          code: error.code,
        });
        return;
      }

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

      // Only workspace admins/owners can provision organizations
      const inviterRole = req.user?.role;
      if (inviterRole !== 'ADMIN' && inviterRole !== 'OWNER') {
        res.status(403).json({ error: 'Only workspace admins can provision organizations' });
        return;
      }

      const prisma = DatabaseClient.getInstance();
      const normalizedOwnerEmail = ownerEmail.trim().toLowerCase();

      await organizationDomainService.assertCanCreateOrgForEmail(normalizedOwnerEmail);

      // Reject if the owner email is already an active member of any org
      // Checks membership of ANY org, not just the caller's.
      const existingMembership = await withWorkspaceScope(() =>
        prisma.orgMember.findFirst({
          where: { email: normalizedOwnerEmail, leftAt: null },
          select: { orgId: true },
        }),
      );
      if (existingMembership) {
        res.status(409).json({
          error: `${ownerEmail.trim()} is already a member of an organisation`,
        });
        return;
      }

      const orgId = createId();
      try {
        await getEncryptionProvider().initializeOrg(orgId);
      } catch (error) {
        logger.error('Failed to initialize org encryption before invitation bootstrap', {
          orgId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      // All creation steps in one transaction — rollback automatically on any failure
      const { org, workspace } = await prisma.$transaction(async tx => {
        const org = await tx.organization.create({
          data: {
            orgId,
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
            workspaceType: WorkspaceType.ENTERPRISE,
            joinPolicy: WorkspaceJoinPolicy.INVITE_ONLY,
          },
        });

        await getEncryptionProvider().provisionEntity({
          entityId: workspace.id,
          orgId: workspace.orgId,
          entityType: 'WORKSPACE',
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
            role: WorkspaceRole.ADMIN,
          },
        });

        // Seed general channel + default project + board/stages
        await createCommunityWorkspaceDefaults({
          db: tx,
          workspaceId: workspace.id,
          workspaceName: workspaceName.trim(),
          createdBy: invitedBy,
        });

        // Add owner as org_member (email-only — no User record yet)
        await tx.orgMember.create({
          data: {
            orgId: org.orgId,
            email: normalizedOwnerEmail,
            role: OrgRole.OWNER,
            invitedBy: req.user?.email ?? undefined,
          },
        });

        return { org, workspace };
      });

      await organizationDomainService.createDomainMappingForOrg({
        orgId: org.orgId,
        email: normalizedOwnerEmail,
        verifiedByUserId: invitedBy,
      });

      // Sync all hardcoded bots into the newly provisioned workspace
      await runAsSystem(() => unifiedBotUserService.syncAllBotUsers(workspace.id));

      // Create invitation outside the transaction (sends email — non-DB side-effect)
      // Run as system because the new org/workspace is not the caller's own —
      // the OrganizationsACL would filter out the org lookup inside createInvitation.
      const invitation = await runAsSystem(() =>
        invitationService.createInvitation({
          email: normalizedOwnerEmail,
          role: WorkspaceRole.OWNER,
          workspaceId: workspace.id,
          orgId: org.orgId,
          invitedBy,
        }),
      );
      invitationId = invitation.invitationId ?? invitation.id;

      const provisionInvitationLink = await buildInvitationLink({
        req,
        workspaceId: workspace.id,
        invitationId,
        inviteExperience: resolveInviteExperience(workspace.metadata),
      });
      const emailResult = await invitationService.sendInvitationEmail({
        to: normalizedOwnerEmail,
        inviterName: req.user?.name ?? 'Administrator',
        workspaceName: workspaceName.trim(),
        invitationLink: provisionInvitationLink,
        invitationId,
        inviteExperience: resolveInviteExperience(workspace.metadata),
      });

      if (!emailResult.success) {
        // 1. Delete invitation
        await invitationService.deleteInvitation(invitation.id);
        
        // 1a. Delete organization domain mappings
        await prisma.organizationDomain.deleteMany({
          where: { orgId: org.orgId },
        });

        // 2. Delete org member
        await withWorkspaceScope(() =>
          prisma.orgMember.delete({ where: { email: normalizedOwnerEmail } }),
        );
        
        // 3. Delete workspace-organization link
        await prisma.workspaceOrganization.delete({ 
          where: { 
            orgId_workspaceId: {
              orgId: org.orgId,
              workspaceId: workspace.id,
            },
          }, 
        });
        
        // 4. Delete DM project
        await prisma.project.deleteMany({ 
          where: { workspaceId: workspace.id, type: ProjectType.DM } 
        });
        
        // 5. Delete workspace users (including bots created during sync)
        await prisma.user.deleteMany({ 
          where: { workspaceId: workspace.id } 
        });
        
        // 6. Delete workspace
        await prisma.workspace.delete({ 
          where: { id: workspace.id } 
        });
        
        // 7. Delete organization
        await prisma.organization.delete({ 
          where: { orgId: org.orgId } 
        });
        
        invitationId = null;
        throw new Error(`Failed to send invitation email: ${emailResult.error}`);
      }

      try {
        await aiProvisioningService.enqueueOrgSync(org.orgId);
        await aiProvisioningService.enqueueWorkspaceSync(workspace.id);
      } catch (error) {
        logger.error('[InvitationController] Failed to enqueue AI provisioning jobs', {
          orgId: org.orgId,
          workspaceId: workspace.id,
          error,
        });
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

      if (isOrganizationPolicyError(error)) {
        res.status(error.statusCode).json({
          error: error.message,
          code: error.code,
          ...(error instanceof Error && 'domain' in error ? { domain: error.domain } : {}),
          ...(error instanceof Error && 'existingOrg' in error ? { existingOrg: error.existingOrg } : {}),
        });
        return;
      }

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
