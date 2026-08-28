/**
 * Invitation Service
 * Handles invitation creation, sending emails, and acceptance
 */

import { PrismaClient, Invitation, User } from '@prisma/client';
import {
  GuestEntity,
  WorkspaceRole,
  WorkspaceType,
  AuthProvider,
  ChannelRole,
  CanvasRole,
  OrgRole, UserStatus } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { withWorkspaceScope } from '@/database/tenant/context';
import { logger } from '@/utils/logger';
import { emailService } from './email/factory';
import { grantPermissionsForRole } from './permissionMatrix';
import crypto from 'crypto';
import { hashPassword, verifyEmailPassword } from '../utils/passwordUtils';
import { redisService } from './redisService';
import { organizationDomainService } from './organizationDomainService';
import { ChannelUserStatusRepository } from '@/database/repositories/channelUserStatusRepository';
import { aiProvisioningService } from './aiProvisioningService';
import { ensureUserInGeneralChannel } from '@/utils/workspaceGeneralChannel';

type TxClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export interface CreateInvitationParams {
  email: string;
  role: WorkspaceRole;
  workspaceId: string;
  invitedBy: string;
  // When provided directly (e.g. from org+workspace creation), skips inviter-org derivation
  // and the invitee-in-org check (the caller already added the invitee as an org member)
  orgId?: string;
  entityId?: string;
  entityType?: GuestEntity;
  channelId?: string;
}

export interface InvitationWithDetails extends Invitation {
  workspace: {
    name: string;
  } | null;
  organization: {
    name: string;
  } | null;
}

const GUEST_INVITATION_TEMP_PASSWORD_PREFIX = 'guestinvitation:temp-password';

interface GuestInvitationTempPasswordPayload {
  email: string;
  passwordHash: string;
}

export class InvitationService {
  private prisma: PrismaClient;
  private channelUserStatusRepository: ChannelUserStatusRepository;

  constructor() {
    this.prisma = DatabaseClient.getInstance();
    this.channelUserStatusRepository = new ChannelUserStatusRepository();
  }

  private toEnterpriseOrgRole(role: WorkspaceRole): OrgRole {
    if (role === WorkspaceRole.OWNER) return OrgRole.OWNER;
    if (role === WorkspaceRole.ADMIN) return OrgRole.ADMIN;
    if (role === WorkspaceRole.COMMUNITY_MEMBER) return OrgRole.COMMUNITY_MEMBER;
    return OrgRole.MEMBER;
  }

  private getGuestInvitationTempPasswordKey(invitationId: string): string {
    return `${GUEST_INVITATION_TEMP_PASSWORD_PREFIX}:${invitationId}`;
  }

  private async readGuestInvitationTempPassword(invitationId: string): Promise<GuestInvitationTempPasswordPayload | null> {
    const raw = await redisService.get(this.getGuestInvitationTempPasswordKey(invitationId));
    if (!raw) return null;

    try {
      const payload = JSON.parse(raw) as Partial<GuestInvitationTempPasswordPayload>;
      if (typeof payload.email !== 'string' || typeof payload.passwordHash !== 'string') {
        return null;
      }
      return { email: payload.email, passwordHash: payload.passwordHash };
    } catch {
      return null;
    }
  }

  private async storeGuestInvitationTempPassword(params: {
    invitationId: string;
    email: string;
    passwordHash: string;
    expiredAt: Date | null;
  }): Promise<void> {
    const now = Date.now();
    const ttlSeconds = params.expiredAt
      ? Math.max(Math.ceil((params.expiredAt.getTime() - now) / 1000), 1)
      : 15 * 24 * 60 * 60;

    await redisService.set(
      this.getGuestInvitationTempPasswordKey(params.invitationId),
      JSON.stringify({ email: params.email, passwordHash: params.passwordHash }),
      ttlSeconds,
    );
  }

  async verifyGuestInvitationTempPassword(params: {
    invitationId: string;
    email: string;
    password: string;
  }): Promise<GuestInvitationTempPasswordPayload | null> {
    const payload = await this.readGuestInvitationTempPassword(params.invitationId);
    if (!payload || payload.email !== params.email.toLowerCase()) return null;

    const valid = await verifyEmailPassword(params.password, payload.passwordHash);
    return valid ? payload : null;
  }

  private async markInvitationAccepted(tx: TxClient, invitationId: string): Promise<void> {
    const result = await tx.invitation.updateMany({
      where: {
        invitationId,
        acceptedAt: null,
      },
      data: { acceptedAt: new Date() },
    });

    if (result.count !== 1) {
      throw new Error('Invitation has already been accepted');
    }
  }

  /**
   * Create a new invitation
   */
  async createInvitation(params: CreateInvitationParams): Promise<InvitationWithDetails> {
    const { role, workspaceId, invitedBy, orgId: explicitOrgId } = params;
    const email = params.email.toLowerCase();

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
      if (role !== WorkspaceRole.GUEST && role !== WorkspaceRole.COMMUNITY_MEMBER) {
        // Looks the invitee up across any org, not just the caller's, so it runs above the caller's own scope.
        // The query MUST be awaited inside the closure: Prisma promises are lazy, so awaiting
        // outside would execute the query after withWorkspaceScope has exited — back in the
        // request context where OrgMembersACL scopes it to the caller's own membership.
        const inviteeInOrg = await withWorkspaceScope(async () => {
          return await this.prisma.orgMember.findFirst({
            where: { email, leftAt: null },
          });
        });

        if (!inviteeInOrg) {
          throw new Error(
            `${email} is not part of any organisation. They must be added to an organisation before being invited to a workspace.`
          );
        }
      }
    }

    if (role === 'GUEST') {
      const inviteeOrgMember = await withWorkspaceScope(async () => {
        return await this.prisma.orgMember.findUnique({
          where: { email },
        });
      });
      if (inviteeOrgMember && inviteeOrgMember.leftAt) {
        throw new Error(
          `${email} is no longer part of an organization and cannot be invited as a guest`
        );
      }
    }

    // Validate role — provision flow (explicit orgId) allows OWNER; normal flow allows ADMIN/MEMBER
    const validRoles: WorkspaceRole[] = explicitOrgId
      ? [WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.MEMBER]
      : [
          WorkspaceRole.ADMIN,
          WorkspaceRole.MEMBER,
          WorkspaceRole.GUEST,
          WorkspaceRole.COMMUNITY_MEMBER,
        ];
    const invitationRole = role && validRoles.includes(role) ? role : WorkspaceRole.MEMBER;

    if (invitationRole === WorkspaceRole.COMMUNITY_MEMBER) {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { workspaceType: true },
      });

      if (workspace?.workspaceType !== WorkspaceType.COMMUNITY) {
        throw new Error('Community member invitations are only supported for community workspaces');
      }
    }

    if (invitationRole === 'GUEST' && (!params.entityId || !params.entityType)) {
      throw new Error('Guest invitations must target a channel or canvas');
    }

    if (invitationRole === 'GUEST' && params.entityId && params.entityType) {
      await this.validateGuestEntity(params.entityId, params.entityType, workspaceId);
    }

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
        workspaceId,
        leftAt: null,
        email,
      },
    });

    if (existingUser) {
      if (invitationRole !== 'GUEST') {
        throw new Error(`User ${email} is already a member of this workspace`);
      }
      if (existingUser.role !== 'GUEST') {
        throw new Error(`User ${email} is already a non-guest member of this workspace`);
      }

      const existingGuestAccess = await this.prisma.guestAccess.findUnique({
        where: {
          userId_accessibleEntityId_accessibleEntityType: {
            userId: existingUser.id,
            accessibleEntityId: params.entityId!,
            accessibleEntityType: params.entityType!,
          },
        },
      });

      if (existingGuestAccess) {
        throw new Error(
          `User ${email} already has guest access to this ${params.entityType?.toLowerCase()}`,
        );
      }
    }

    // Guest invites are entity-scoped so the same guest can receive multiple channel/project/canvas invites.
    const activeInvitation = await this.prisma.invitation.findFirst({
      where: {
        email,
        workspaceId,
        ...(invitationRole === 'GUEST'
          ? {
              role: WorkspaceRole.GUEST,
              entityId: params.entityId,
              entityType: params.entityType,
            }
          : {}),
        acceptedAt: null,
        expiredAt: {
          gt: new Date(),
        },
      },
    });

    if (activeInvitation) {
      if (invitationRole === 'GUEST' && !existingUser) {
        const activeTempPassword = await this.readGuestInvitationTempPassword(activeInvitation.invitationId ?? activeInvitation.id);
        if (!activeTempPassword) {
          await this.prisma.invitation.update({
            where: { id: activeInvitation.id },
            data: { expiredAt: new Date() },
          });
        } else {
          throw new Error(`An invitation for ${email} already exists in this workspace`);
        }
      } else {
        throw new Error(`An invitation for ${email} already exists in this workspace`);
      }
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
        entityId: params.entityId,
        entityType: params.entityType,
        channelId: params.channelId,
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
    const deleted = await this.prisma.invitation.delete({
      where: { id },
      select: { id: true, invitationId: true },
    });

    await redisService.del(this.getGuestInvitationTempPasswordKey(deleted.invitationId ?? deleted.id));

    logger.info(`[InvitationService] Deleted invitation ${id}`);
  }

  /**
   * Ensure orgMember has a password. If not, generate a temporary one,
   * hash it, store it, and return the plaintext for the invitation email.
   */
  async generateOrgMemberPassword(email: string): Promise<string> {
    return withWorkspaceScope(async () => {
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
    });
  }

  /**
   * Generate a first-login password for a guest invitation without writing an
   * OrgMember yet. The hash lives only in Redis and expires with the invitation.
   */
  async generateGuestInvitationTempPassword(invitation: Pick<Invitation, 'invitationId' | 'id' | 'email' | 'expiredAt'>): Promise<string> {
    const tempPassword = crypto.randomBytes(12).toString('base64url'); // ~16 chars
    const passwordHash = await hashPassword(tempPassword);

    await this.storeGuestInvitationTempPassword({
      invitationId: invitation.invitationId ?? invitation.id,
      email: invitation.email.toLowerCase(),
      passwordHash,
      expiredAt: invitation.expiredAt,
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

  private async ensureChannelGuestState(channelId: string, userId: string, workspaceId: string, tx: TxClient): Promise<void> {
    await tx.channelParticipant.upsert({
      where: {
        channelId_userId: {
          channelId,
          userId,
        },
      },
      update: {},
      create: {
        channelId,
        userId,
        workspaceId,
        role: ChannelRole.MEMBER,
      },
    });

    await this.channelUserStatusRepository.upsert(channelId, userId, {
      lastViewedAt: new Date(),
    }, tx);
  }

  private async assertCanvasInWorkspace(canvasId: string, workspaceId: string, tx: TxClient): Promise<void> {
    const canvas = await tx.canvas.findUnique({
      where: { id: canvasId },
      select: {
        channelId: true,
        projectId: true,
        createdBy: true,
      },
    });

    if (!canvas) {
      throw new Error('Guest invitation target canvas does not exist');
    }

    if (canvas.channelId) {
      const channel = await tx.channel.findFirst({
        where: { id: canvas.channelId, workspaceId },
        select: { id: true },
      });
      if (!channel) {
        throw new Error('Guest invitation target canvas is not in this workspace');
      }
      return;
    }

    if (canvas.projectId) {
      const project = await tx.project.findFirst({
        where: { id: canvas.projectId, workspaceId },
        select: { id: true },
      });
      if (!project) {
        throw new Error('Guest invitation target canvas is not in this workspace');
      }
      return;
    }

    const creator = await tx.user.findFirst({
      where: { id: canvas.createdBy, workspaceId },
      select: { id: true },
    });
    if (!creator) {
      throw new Error('Guest invitation target canvas is not in this workspace');
    }
  }

  private async validateGuestEntity(
    entityId: string,
    entityType: string,
    workspaceId: string,
  ): Promise<void> {
    switch (entityType) {
      case GuestEntity.CHANNEL: {
        const channel = await this.prisma.channel.findFirst({
          where: { id: entityId, workspaceId, isArchived: false },
          select: { id: true },
        });
        if (!channel) {
          throw new Error('Guest invitation target channel does not exist in this workspace');
        }
        return;
      }

      case GuestEntity.CANVAS: {
        const canvas = await this.prisma.canvas.findUnique({
          where: { id: entityId },
          select: { channelId: true, projectId: true, createdBy: true },
        });
        if (!canvas) {
          throw new Error('Guest invitation target canvas does not exist');
        }
        if (canvas.channelId) {
          const channel = await this.prisma.channel.findFirst({
            where: { id: canvas.channelId, workspaceId },
            select: { id: true },
          });
          if (!channel) {
            throw new Error('Guest invitation target canvas is not in this workspace');
          }
        } else if (canvas.projectId) {
          const project = await this.prisma.project.findFirst({
            where: { id: canvas.projectId, workspaceId },
            select: { id: true },
          });
          if (!project) {
            throw new Error('Guest invitation target canvas is not in this workspace');
          }
        } else {
          const creator = await this.prisma.user.findFirst({
            where: { id: canvas.createdBy, workspaceId },
            select: { id: true },
          });
          if (!creator) {
            throw new Error('Guest invitation target canvas is not in this workspace');
          }
        }
        return;
      }

      default:
        throw new Error(`Unsupported guest invitation entity type: ${entityType}`);
    }
  }

  private async grantGuestEntityAccess(userId: string, invitation: Invitation, tx: TxClient): Promise<string | null> {
    if (invitation.role !== 'GUEST') {
      return null;
    }

    const workspaceId = invitation.workspaceId;
    const entityId = invitation.entityId;
    const entityType = invitation.entityType;

    if (!workspaceId || !entityId || !entityType) {
      throw new Error('Guest invitation is missing its target entity');
    }

    await tx.guestAccess.upsert({
      where: {
        userId_accessibleEntityId_accessibleEntityType: {
          userId,
          accessibleEntityId: entityId,
          accessibleEntityType: entityType,
        },
      },
      update: {
        workspaceId,
        invitedBy: invitation.invitedBy,
      },
      create: {
        userId,
        accessibleEntityId: entityId,
        accessibleEntityType: entityType,
        workspaceId,
        invitedBy: invitation.invitedBy,
        createdAt: new Date(),
      },
    });

    logger.info(`[InvitationService] Granted guest access userId=${userId} entityId=${entityId} entityType=${entityType}`);

    if (entityType === GuestEntity.CHANNEL) {
      const channel = await tx.channel.findFirst({
        where: { id: entityId, workspaceId },
        select: { id: true, isArchived: true },
      });
      if (!channel) {
        throw new Error('Guest invitation target channel does not exist in this workspace');
      }
      if (channel.isArchived) {
        throw new Error('Guest invitation target channel is archived');
      }

      await this.ensureChannelGuestState(entityId, userId, workspaceId, tx);
      return `/${workspaceId}/chat/dir/${entityId}`;
    }

    if (entityType === GuestEntity.CANVAS) {
      await this.assertCanvasInWorkspace(entityId, workspaceId, tx);
      await tx.canvasParticipant.upsert({
        where: {
          canvasId_userId: {
            canvasId: entityId,
            userId,
          },
        },
        update: {},
        create: {
          canvasId: entityId,
          userId,
          workspaceId,
          role: CanvasRole.VIEWER,
        },
      });
      return `/${workspaceId}/chat/canvas/${entityId}`;
    }

    throw new Error(`Unsupported guest invitation entity type: ${entityType}`);
  }

  /**
   * Handle guest invitation acceptance: creates orgMember with GUEST role,
   * workspace user, GuestAccess, and entity-specific participant.
   * Returns the created user and a frontend redirect path for the invited entity.
   */
  private async handleGuestAcceptance(
    invitation: Invitation,
    userData: {
      id: string;
      email: string;
      name: string;
      providerUserId: string;
      authProvider: string;
      passwordHash?: string;
    },
    tx: TxClient,
  ): Promise<{ user: User; redirectPath: string | null }> {
    const orgMember = await tx.orgMember.findUnique({
      where: { email: userData.email.toLowerCase() },
    });

    if (orgMember && orgMember.leftAt) {
      throw new Error(`Cannot accept invitation — ${userData.email} is no longer part of the organization`);
    }

    if (userData.authProvider === AuthProvider.EMAIL && !orgMember?.passwordHash && !userData.passwordHash) {
      throw new Error('Guest invitation password has expired. Please ask the sender to re-invite you.');
    }

    const activeOrgMember = orgMember ?? await tx.orgMember.create({
      data: {
        orgId: invitation.orgId!,
        email: userData.email.toLowerCase(),
        role: OrgRole.GUEST,
        ...(userData.passwordHash ? { passwordHash: userData.passwordHash } : {}),
      },
    });

    if (!orgMember) {
      logger.info(`[DEBUG] [handleGuestAcceptance] Created new orgMember with GUEST role id=${activeOrgMember.memberId}`);
    } else if (!orgMember.passwordHash && userData.passwordHash) {
      await tx.orgMember.update({
        where: { memberId: activeOrgMember.memberId },
        data: { passwordHash: userData.passwordHash, leftAt: null },
      });
    }

    const newWorkspaceUser = await tx.user.create({
      data: {
        email: userData.email,
        name: userData.name,
        providerUserId: userData.providerUserId,
        authProvider: userData.authProvider as AuthProvider,
        workspaceId: invitation.workspaceId!,
        role: invitation.role,
        status: UserStatus.ACTIVE,
        orgMemberId: activeOrgMember.memberId,
      },
    });
    logger.info(`[DEBUG] [handleGuestAcceptance] Created new workspace GUEST user id=${newWorkspaceUser.id}`);

    const redirectPath = await this.grantGuestEntityAccess(newWorkspaceUser.id, invitation, tx);

    return { user: newWorkspaceUser, redirectPath };
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
      passwordHash?: string;
    };
  }): Promise<{ user: User; redirectPath: string | null }> {
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

    if (invitation.acceptedAt) {
      logger.warn(`[DEBUG] [acceptInvitation] Invitation ${invitationId} was already accepted at ${invitation.acceptedAt.toISOString()}`);
      throw new Error('Invitation has already been accepted');
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

    const guestInvitationTempPassword = invitation.role === 'GUEST' && userData.authProvider === AuthProvider.EMAIL
      ? await this.readGuestInvitationTempPassword(invitationId)
      : null;
    const guestUserData = guestInvitationTempPassword
      ? { ...userData, passwordHash: guestInvitationTempPassword.passwordHash }
      : userData;

    // Check if user already exists in this workspace (duplicate accept guard)
    const existingWorkspaceUser = await this.prisma.user.findFirst({
      where: {
        workspaceId: invitation.workspaceId!,
        OR: [
          { providerUserId: userData.providerUserId },
          { email: userData.email },
          { email: userData.email.toLowerCase() },
        ],
      },
    });
    logger.info(`[DEBUG] [acceptInvitation] User providerUserId=${userData.providerUserId} already in workspace ${invitation.workspaceId}: ${!!existingWorkspaceUser}`);

    let newWorkspaceUser: User;
    let redirectPath: string | null = null;
    let upgradeCommunityMemberId: string | null = null;

    if (!existingWorkspaceUser && invitation.role === 'GUEST') {
      const guestResult = await this.prisma.$transaction(async (tx) => {
        await this.markInvitationAccepted(tx, invitationId);
        const result = await this.handleGuestAcceptance(invitation, guestUserData, tx);
        return result;
      });
      newWorkspaceUser = guestResult.user;
      redirectPath = guestResult.redirectPath;
    } else if (existingWorkspaceUser) {
      if (invitation.role === 'GUEST') {
        if (existingWorkspaceUser.role !== 'GUEST') {
          throw new Error('Existing workspace members cannot accept guest invitations');
        }

        const orgMember = await this.prisma.orgMember.findUnique({
          where: { email: userData.email.toLowerCase() },
          select: { leftAt: true },
        });
        if (orgMember?.leftAt) {
          throw new Error(`Cannot accept invitation — ${userData.email} is no longer part of the organization`);
        }

        const guestResult = await this.prisma.$transaction(async (tx) => {
          await this.markInvitationAccepted(tx, invitationId);
          const reactivatedUser = await tx.user.update({
            where: { id: existingWorkspaceUser.id },
            data: {
              leftAt: null,
              status: UserStatus.ACTIVE,
            },
          });
          const path = await this.grantGuestEntityAccess(reactivatedUser.id, invitation, tx);
          return { user: reactivatedUser, redirectPath: path };
        });
        newWorkspaceUser = guestResult.user;
        redirectPath = guestResult.redirectPath;
        logger.info(`[DEBUG] [acceptInvitation] Granted existing guest user id=${newWorkspaceUser.id} access to invitation entity`);
      } else {
        // User exists - reactivate + orgMember upsert + invitation accept in one transaction
        newWorkspaceUser = await this.prisma.$transaction(async (tx) => {
          await this.markInvitationAccepted(tx, invitationId);
          const reactivatedUser = await tx.user.update({
            where: { id: existingWorkspaceUser.id },
            data: {
              leftAt: null,
              role: invitation.role,
              status: UserStatus.ACTIVE,
            },
          });

          if (resolvedOrgId) {
            await tx.orgMember.upsert({
              where: { email: userData.email.toLowerCase() },
              create: {
                orgId: resolvedOrgId,
                email: userData.email.toLowerCase(),
                role: this.toEnterpriseOrgRole(invitation.role as WorkspaceRole),
              },
              update: {
                leftAt: null,
                orgId: resolvedOrgId,
                role: this.toEnterpriseOrgRole(invitation.role as WorkspaceRole),
              },
            });
          }

          return reactivatedUser;
        });
        logger.info(`[DEBUG] [acceptInvitation] Reactivated existing user id=${newWorkspaceUser.id}`);
      }
    } else {
      // New user — orgMember create/update + user create + invitation accept in one transaction
      if (resolvedOrgId) {
        await organizationDomainService.assertOrgMemberLimit(resolvedOrgId, userData.email);
      }

      newWorkspaceUser = await this.prisma.$transaction(async (tx) => {
        await this.markInvitationAccepted(tx, invitationId);
        const existingOrgMember = await tx.orgMember.findUnique({
          where: { email: userData.email.toLowerCase() },
          select: { memberId: true, role: true },
        });

        let orgMemberId: string;

        if (!existingOrgMember) {
          if (!resolvedOrgId) {
            throw new Error(`orgMember not found for email ${userData.email}. User must be invited to the organization first.`);
          }

          const created = await tx.orgMember.create({
            data: {
              orgId: resolvedOrgId,
              email: userData.email.toLowerCase(),
              role: this.toEnterpriseOrgRole(invitation.role as WorkspaceRole),
            },
            select: { memberId: true },
          });
          orgMemberId = created.memberId;
        } else if (resolvedOrgId) {
          const wasCommunityMember = existingOrgMember.role === 'COMMUNITY_MEMBER';
          const updated = await tx.orgMember.update({
            where: { memberId: existingOrgMember.memberId },
            data: {
              leftAt: null,
              orgId: resolvedOrgId,
              role: this.toEnterpriseOrgRole(invitation.role as WorkspaceRole),
            },
            select: { memberId: true },
          });
          orgMemberId = updated.memberId;

          if (wasCommunityMember) {
            upgradeCommunityMemberId = orgMemberId;
          }
        } else {
          orgMemberId = existingOrgMember.memberId;
        }

        const createdUser = await tx.user.create({
          data: {
            email: userData.email,
            name: userData.name,
            providerUserId: userData.providerUserId,
            authProvider: userData.authProvider as AuthProvider,
            workspaceId: invitation.workspaceId!,
            role: invitation.role,
            status: UserStatus.ACTIVE,
            orgMemberId,
          },
        });
        logger.info(`[DEBUG] [acceptInvitation] Created new workspace user id=${createdUser.id}`);

        return createdUser;
      });
    }

    // ── Post-commit side effects (best-effort, must not roll back the
    //    transaction above). These are idempotent or error-swallowing. ──

    if (upgradeCommunityMemberId) {
      try {
        await aiProvisioningService.upgradeCommunityToEnterpriseBudget(upgradeCommunityMemberId);
      } catch (error) {
        logger.error('[InvitationService] Failed to upgrade community budget', {
          memberId: upgradeCommunityMemberId,
          error,
        });
      }
    }

    // Grant role-based resource permissions via the centralized permission matrix
    await grantPermissionsForRole(
      newWorkspaceUser.id,
      newWorkspaceUser.email,
      invitation.role as WorkspaceRole,
      invitation.workspaceId,
    );
    logger.info(`[InvitationService] Permission grants completed for ${invitation.role} user ${userData.email}`);

    logger.info(`[InvitationService] User ${userData.email} accepted invitation to workspace ${invitation.workspaceId}`);

    try {
      await aiProvisioningService.enqueueUserSync(newWorkspaceUser.orgMemberId);
    } catch (error) {
      logger.error('[InvitationService] Failed to enqueue AI user provisioning', {
        userId: newWorkspaceUser.id,
        workspaceId: invitation.workspaceId,
        error,
      });
    }

    if (invitation.role !== 'GUEST' && invitation.workspaceId) {
      await ensureUserInGeneralChannel(
        this.prisma,
        invitation.workspaceId,
        newWorkspaceUser.id,
        ChannelRole.MEMBER,
      );
    }

    if (guestInvitationTempPassword) {
      await redisService.del(this.getGuestInvitationTempPasswordKey(invitationId));
    }

    return { user: newWorkspaceUser, redirectPath };
  }
}

// Export singleton instance
export const invitationService = new InvitationService();
