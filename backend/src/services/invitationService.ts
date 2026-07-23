/**
 * Invitation Service
 * Handles invitation creation, sending emails, and acceptance
 */

import { PrismaClient, WorkspaceRole, Invitation, AuthProvider } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { emailService } from './email/factory';
import { grantPermissionsForRole } from './permissionMatrix';
import crypto from 'crypto';
import { hashPassword } from '../utils/passwordUtils';
import { organizationDomainService } from './organizationDomainService';

export interface CreateInvitationParams {
  email: string;
  role: WorkspaceRole;
  workspaceId: string;
  invitedBy: string;
  // When provided directly (e.g. from org+workspace creation), skips inviter-org derivation
  // and the invitee-in-org check (the caller already added the invitee as an org member)
  orgId?: string;
}

export interface InvitationWithDetails extends Invitation {
  workspace: {
    name: string;
  } | null;
  organization: {
    name: string;
  } | null;
}

export class InvitationService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = DatabaseClient.getInstance();
  }

  private toEnterpriseOrgRole(role: WorkspaceRole): 'OWNER' | 'ADMIN' | 'MEMBER' {
    if (role === WorkspaceRole.OWNER) return 'OWNER';
    if (role === WorkspaceRole.ADMIN) return 'ADMIN';
    return 'MEMBER';
  }

  /**
   * Create a new invitation
   */
  async createInvitation(params: CreateInvitationParams): Promise<InvitationWithDetails> {
    const { email, role, workspaceId, invitedBy, orgId: explicitOrgId } = params;

    let orgId: string;

    if (explicitOrgId) {
      // orgId supplied directly — skip inviter-org derivation and invitee-in-org check
      // (caller is responsible for having already added the invitee as an org member)
      orgId = explicitOrgId;
    } else {
      // Derive orgId from the inviting user's active org membership
      const inviter = await this.prisma.user.findUnique({
        where: { id: invitedBy },
        select: { email: true },
      });
      const inviterOrgMember = await this.prisma.orgMember.findFirst({
        where: { email: inviter?.email ?? '', leftAt: null },
        select: { orgId: true },
      });
      const derivedOrgId = inviterOrgMember?.orgId;

      if (!derivedOrgId) {
        throw new Error('You must be a member of an organization to invite others');
      }
      orgId = derivedOrgId;

      // Ensure the invitee exists in the org_members table (any org)
      const inviteeInOrg = await this.prisma.orgMember.findFirst({
        where: { email: email.toLowerCase(), leftAt: null },
      });

      if (!inviteeInOrg) {
        throw new Error(
          `${email} is not part of any organisation. They must be added to an organisation before being invited to a workspace.`
        );
      }
    }

    // Validate role — provision flow (explicit orgId) allows OWNER; normal flow allows ADMIN/MEMBER
    const validRoles: WorkspaceRole[] = explicitOrgId
      ? ['OWNER', 'ADMIN', 'MEMBER']
      : ['ADMIN', 'MEMBER'];
    const invitationRole = role && validRoles.includes(role) ? role : 'MEMBER';

    const selectedOrg = await this.prisma.organization.findUnique({
      where: { orgId },
      select: { name: true },
    });

    if (!selectedOrg) {
      throw new Error('Selected organization not found');
    }

    await organizationDomainService.assertOrgMemberLimit(orgId, email);

    const existingUser = await this.prisma.user.findFirst({
      where: {
        email,
        workspaceId,
        leftAt: null,
      },
    });

    if (existingUser) {
      throw new Error(`User ${email} is already a member of this workspace`);
    }

    // Check if there's already a pending (non-expired, non-accepted) invitation for this email in this workspace
    const activeInvitation = await this.prisma.invitation.findFirst({
      where: {
        email,
        workspaceId,
        acceptedAt: null,
        expiredAt: {
          gt: new Date(),
        },
      },
    });

    if (activeInvitation) {
      throw new Error(`An invitation for ${email} already exists in this workspace`);
    }

    // Calculate expiration date (15 days from now)
    const expiredAt = new Date();
    expiredAt.setDate(expiredAt.getDate() + 15);

    // Generate a unique invitationId for the invitation URL
    const invitationLinkId = crypto.randomBytes(16).toString('hex');

    // Create the invitation with workspace details
    const invitation = await this.prisma.invitation.create({
      data: {
        email,
        role: invitationRole,
        workspaceId,
        orgId,
        invitedBy,
        invitedAt: new Date(),
        expiredAt,
        invitationId: invitationLinkId,
      },
      include: {
        workspace: {
          select: { name: true },
        },
        organization: {
          select: { name: true },
        },
      },
    });

    logger.info(`[InvitationService] Created invitation with id=${invitation.id}, invitationId=${invitationLinkId} for ${email}`);

    return invitation;
  }

  /**
   * Get invitation by ID
   */
  async getInvitationById(id: string): Promise<InvitationWithDetails | null> {
    return await this.prisma.invitation.findUnique({
      where: { id },
      include: {
        workspace: {
          select: { name: true },
        },
        organization: {
          select: { name: true },
        },
      },
    });
  }

  /**
   * Get invitation by invitationId (public token)
   */
  async getInvitationByInvitationId(invitationId: string): Promise<InvitationWithDetails | null> {
    return await this.prisma.invitation.findUnique({
      where: { invitationId },
      include: {
        workspace: {
          select: { name: true },
        },
        organization: {
          select: { name: true },
        },
      },
    });
  }

  /**
   * Delete an invitation completely (used for cleanup on failure)
   */
  async deleteInvitation(id: string): Promise<void> {
    await this.prisma.invitation.delete({
      where: { id },
    });

    logger.info(`[InvitationService] Deleted invitation ${id}`);
  }

  /**
   * Ensure orgMember has a password. If not, generate a temporary one,
   * hash it, store it, and return the plaintext for the invitation email.
   */
  async generateOrgMemberPassword(email: string): Promise<string> {
    const orgMember = await this.prisma.orgMember.findUnique({
      where: { email: email.toLowerCase() },
      select: { memberId: true, passwordHash: true },
    });

    if (!orgMember) {
      throw new Error(`orgMember not found for ${email}`);
    }

    const tempPassword = crypto.randomBytes(12).toString('base64url'); // ~16 chars
    const hashed = await hashPassword(tempPassword);

    await this.prisma.orgMember.update({
      where: { memberId: orgMember.memberId },
      data: { passwordHash: hashed },
    });

    return tempPassword;
  }

  /**
   * Send invitation email using the configured email service
   */
  async sendInvitationEmail(params: {
    to: string;
    inviterName: string;
    workspaceName: string;
    invitationLink: string;
    invitationId: string;
    tempPassword?: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const { to, inviterName, workspaceName, invitationLink, invitationId, tempPassword } = params;

    const result = await emailService.sendInvitationEmail({
      to,
      inviterName,
      workspaceName,
      invitationLink,
      invitationId,
      tempPassword,
    });

    if (result.success) {
      logger.info(`[InvitationService] Invitation email sent to ${to}, messageId: ${result.messageId}`);
    } else {
      logger.error(`[InvitationService] Failed to send invitation email to ${to}: ${result.error}`);
    }

    return result;
  }

  /**
   * Accept an invitation and create a user
   */
  async acceptInvitation(params: {
    invitationId: string;
    userData: {
      id: string;
      email: string;
      name: string;
      providerUserId: string;
      authProvider: string;
    };
  }): Promise<void> {
    const { invitationId, userData } = params;

    const invitation = await this.prisma.invitation.findUnique({
      where: { invitationId: invitationId },
    });

    logger.info(`[DEBUG] [acceptInvitation] Looking up invitationId=${invitationId} → found=${!!invitation}`);

    if (!invitation) {
      throw new Error('Invitation not found');
    }

    // Check if invitation is expired
    if (invitation.expiredAt && invitation.expiredAt < new Date()) {
      logger.warn(`[DEBUG] [acceptInvitation] Invitation ${invitationId} expired at ${invitation.expiredAt.toISOString()}`);
      throw new Error('Invitation has expired');
    }

    // Verify the email matches
    if (invitation.email.toLowerCase() !== userData.email.toLowerCase()) {
      logger.warn(`[DEBUG] [acceptInvitation] Email mismatch: invitation.email=${invitation.email} vs userData.email=${userData.email}`);
      throw new Error('Email does not match the invitation');
    }

    logger.info(`[DEBUG] [acceptInvitation] Invitation valid. workspaceId=${invitation.workspaceId} orgId=${invitation.orgId ?? 'null'} role=${invitation.role}`);

    // Resolve orgId before user creation so a COMMUNITY_MEMBER org row can be
    // moved/upgraded into the enterprise org when the invite is accepted.
    const resolvedOrgId = invitation.orgId ?? (
      await this.prisma.workspace.findUnique({
        where: { id: invitation.workspaceId! },
        select: { orgId: true },
      })
    )?.orgId ?? null;

    logger.info(`[DEBUG] [acceptInvitation] resolvedOrgId=${resolvedOrgId ?? 'null'} (from invitation.orgId=${invitation.orgId ?? 'null'})`);

    // Check if user already exists in this workspace (duplicate accept guard)
    const existingWorkspaceUser = await this.prisma.user.findUnique({
      where: {
        providerUserId_workspaceId: {
          providerUserId: userData.providerUserId,
          workspaceId: invitation.workspaceId!,
        },
      },
    });
    logger.info(`[DEBUG] [acceptInvitation] User providerUserId=${userData.providerUserId} already in workspace ${invitation.workspaceId}: ${!!existingWorkspaceUser}`);

    let newWorkspaceUser;

    if (existingWorkspaceUser) {
      // User exists - reactivate them if they were removed (leftAt is set)
      newWorkspaceUser = await this.prisma.user.update({
        where: { id: existingWorkspaceUser.id },
        data: {
          leftAt: null,
          role: invitation.role,
          status: 'ACTIVE',
        },
      });
      logger.info(`[DEBUG] [acceptInvitation] Reactivated existing user id=${newWorkspaceUser.id}`);
    } else {
      if (resolvedOrgId) {
        await organizationDomainService.assertOrgMemberLimit(resolvedOrgId, userData.email);
      }

      // Fetch existing orgMember by email
      let orgMember = await this.prisma.orgMember.findUnique({
        where: { email: userData.email.toLowerCase() },
        select: { memberId: true }
      });

      if (!orgMember) {
        if (!resolvedOrgId) {
          throw new Error(`orgMember not found for email ${userData.email}. User must be invited to the organization first.`);
        }

        orgMember = await this.prisma.orgMember.create({
          data: {
            orgId: resolvedOrgId,
            email: userData.email.toLowerCase(),
            role: this.toEnterpriseOrgRole(invitation.role),
          },
          select: { memberId: true },
        });
      } else if (resolvedOrgId) {
        orgMember = await this.prisma.orgMember.update({
          where: { memberId: orgMember.memberId },
          data: {
            leftAt: null,
            orgId: resolvedOrgId,
            role: this.toEnterpriseOrgRole(invitation.role),
          },
          select: { memberId: true },
        });
      }

      // Create new user in the workspace
      newWorkspaceUser = await this.prisma.user.create({
        data: {
          email: userData.email,
          name: userData.name,
          providerUserId: userData.providerUserId,
          authProvider: userData.authProvider as AuthProvider,
          workspaceId: invitation.workspaceId!,
          role: invitation.role,
          status: 'ACTIVE',
          orgMemberId: orgMember.memberId,
        },
      });
      logger.info(`[DEBUG] [acceptInvitation] Created new workspace user id=${newWorkspaceUser.id}`);
    }

    // Ensure an OrgMember entry exists for this email (upsert by email - now globally unique)
    if (resolvedOrgId) {
      await this.prisma.orgMember.upsert({
        where: { email: userData.email.toLowerCase() },
        create: {
          orgId: resolvedOrgId,
          email: userData.email.toLowerCase(),
          role: this.toEnterpriseOrgRole(invitation.role),
        },
        update: {
          leftAt: null,
          orgId: resolvedOrgId,
          role: this.toEnterpriseOrgRole(invitation.role),
        }, // reactivate and update orgId/role if needed
      });
      logger.info(`[DEBUG] [acceptInvitation] OrgMember upserted for email=${userData.email} orgId=${resolvedOrgId}`);
    } else {
      logger.warn(`[DEBUG] [acceptInvitation] ⚠️ Could not resolve orgId — OrgMember NOT created for email=${userData.email}`);
    }

    // Update invitation with acceptedAt timestamp instead of deleting
    await this.prisma.invitation.update({
      where: { invitationId: invitationId },
      data: {
        acceptedAt: new Date(),
      },
    });

    // Grant role-based resource permissions via the centralized permission matrix
    await grantPermissionsForRole(
      newWorkspaceUser.id,
      newWorkspaceUser.email,
      invitation.role,
      invitation.workspaceId ?? undefined,
    );
    logger.info(`[InvitationService] Permission grants completed for ${invitation.role} user ${userData.email}`);

    logger.info(`[InvitationService] User ${userData.email} accepted invitation to workspace ${invitation.workspaceId}`);
  }
}

// Export singleton instance
export const invitationService = new InvitationService();
