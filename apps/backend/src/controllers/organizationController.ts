import { Request, Response } from 'express';
import { OrganizationRepository } from '../database/repositories/organizationRepository';
import { UserRepository } from '../database/repositories/users';
import { DatabaseClient } from '../database/client';
import { runAsSystem } from '../database/tenant/context';
import { logger } from '@/utils/logger';
import { invitationService } from '@/services/invitationService';
import { WorkspaceJoinPolicy, WorkspaceType, OrgRole, ProjectType, WorkspaceRole, Status } from '@xyne/shared';
import { aiProvisioningService } from '@/services/aiProvisioningService';
import { isOrganizationPolicyError, organizationDomainService } from '@/services/organizationDomainService';
import { buildInvitationLink } from '@/controllers/invitationController';
import { createCommunityWorkspaceDefaults } from '@/utils/communityWorkspaceDefaults';
import { getEncryptionProvider } from '@/services/encryption';
import { createId } from '@paralleldrive/cuid2';

// Create OrgMemberRepository interface since we don't have the full file yet
interface OrgMember {
  memberId: string;
  orgId: string;
  userId: string;
  role: OrgRole;
  joinedAt: Date;
  invitedBy?: string;
}

interface CreateOrgMemberInput {
  orgId: string;
  userId: string;
  role: OrgRole;
  invitedBy?: string;
}

// Simple OrgMemberRepository class (this should be moved to a separate file)
class OrgMemberRepository {
  private db: any;

  constructor() {
    this.db = DatabaseClient.getInstance();
  }

  async create(data: CreateOrgMemberInput): Promise<OrgMember> {
    return await this.db.orgMember.create({ data });
  }

  async findMember(orgId: string, userId: string): Promise<OrgMember | null> {
    return await this.db.orgMember.findUnique({
      where: {
        orgId_userId: { orgId, userId }
      }
    });
  }

  async getOrgMembers(orgId: string): Promise<OrgMember[]> {
    return await this.db.orgMember.findMany({
      where: { orgId },
      orderBy: { joinedAt: 'asc' }
    });
  }

  async getUserOrgs(userId: string): Promise<OrgMember[]> {
    return await this.db.orgMember.findMany({
      where: { userId },
      orderBy: { joinedAt: 'desc' }
    });
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    await this.db.orgMember.delete({
      where: {
        orgId_userId: { orgId, userId }
      }
    });
  }

  async updateMemberRole(orgId: string, userId: string, role: OrgRole): Promise<OrgMember> {
    return await this.db.orgMember.update({
      where: {
        orgId_userId: { orgId, userId }
      },
      data: { role }
    });
  }
}

export class OrganizationController {
  private organizationRepository: OrganizationRepository;
  private orgMemberRepository: OrgMemberRepository;
  private userRepository: UserRepository;

  constructor() {
    this.organizationRepository = new OrganizationRepository();
    this.orgMemberRepository = new OrgMemberRepository();
    this.userRepository = new UserRepository();
  }

  // Helper method to get user info
  private async getUserInfo(userId: string) {
    try {
      const user = await this.userRepository.findById(userId);
      if (user) {
        return {
          id: user.id,
          name: user.name,
          email: user.email
        };
      }
    } catch (error) {
      logger.warn(`Failed to lookup user ${userId}:`, error);
    }

    return {
      id: userId,
      name: 'User',
      email: 'user@example.com'
    };
  }

  // POST /api/organizations - Create new organization with workspace, owner, and invitation
  createOrganization = async (req: Request, res: Response): Promise<void> => {
    const db = DatabaseClient.getInstance();
    try {
      const {
        name,
        description,
        workspaceName,
        ownerEmail,
      }: {
        name: string;
        description?: string;
        workspaceName: string;
        ownerEmail: string;
      } = req.body;

      const userId = req.user!.id;
      const currentUser = await db.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (currentUser?.role === 'GUEST') {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Guest users cannot create organizations',
        });
        return;
      }

      // Validate required fields
      if (!name || name.trim() === '') {
        res.status(400).json({ error: 'Organization name is required' });
        return;
      }
      if (!workspaceName || workspaceName.trim() === '') {
        res.status(400).json({ error: 'Workspace name is required' });
        return;
      }
      if (!ownerEmail || ownerEmail.trim() === '') {
        res.status(400).json({ error: 'Owner email is required' });
        return;
      }

      await organizationDomainService.assertCanCreateOrgForEmail(ownerEmail.trim());

      // Check if organization name already exists
      const existingOrg = await this.organizationRepository.findByName(name.trim());
      if (existingOrg) {
        res.status(409).json({ error: 'Organization name already exists' });
        return;
      }

      const orgId = createId();
      try {
        await getEncryptionProvider().initializeOrg(orgId);
      } catch (error) {
        logger.error('Failed to initialize org encryption before organization creation', {
          orgId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      // The new workspace/org has no relation to the caller's own workspace, so
      // tenant ACLs would filter out provisioning reads. Run as system and keep
      // the DB provisioning writes atomic.
      const { organization, workspace } = await runAsSystem(async () =>
        db.$transaction(async (tx) => {
          // 1. Create organization
          const organization = await tx.organization.create({
            data: {
              orgId,
              name: name.trim(),
              description: description?.trim(),
              createdBy: userId,
              status: Status.ACTIVE,
            },
          });

          // 2. Create workspace for the org
          const workspace = await tx.workspace.create({
            data: {
              orgId: organization.orgId,
              name: workspaceName.trim(),
              createdBy: userId,
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

          // 3. Create DM project for the workspace (required by the system)
          await tx.project.create({
            data: {
              name: 'Direct Messages',
              code: 'DM',
              description: 'DM project for direct message channels',
              type: ProjectType.DM,
              workspaceId: workspace.id,
              createdBy: userId,
            },
          });

          // 4. Link workspace to organization
          await tx.workspaceOrganization.create({
            data: {
              orgId: organization.orgId,
              workspaceId: workspace.id,
              role: WorkspaceRole.ADMIN,
            },
          });

          // 4b. Seed general channel + default project + board/stages
          await createCommunityWorkspaceDefaults({
            db: tx,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            createdBy: userId,
          });

          // 5. Add ownerEmail as org OWNER (email-only, no user account yet)
          await tx.orgMember.create({
            data: {
              orgId: organization.orgId,
              email: ownerEmail.trim().toLowerCase(),
              role: OrgRole.OWNER,
              invitedBy: userId,
            },
          });

          return { organization, workspace };
        }),
      );

      await organizationDomainService.createDomainMappingForOrg({
        orgId: organization.orgId,
        email: ownerEmail.trim(),
        verifiedByUserId: userId,
      });

      const invitation = await runAsSystem(() =>
        invitationService.createInvitation({
          email: ownerEmail.trim().toLowerCase(),
          role: WorkspaceRole.OWNER,
          workspaceId: workspace.id,
          invitedBy: userId,
          orgId: organization.orgId,
        }),
      );

      await invitationService.sendInvitationEmail({
        to: ownerEmail.trim(),
        inviterName: req.user!.name || 'Admin',
        workspaceName: workspaceName.trim(),
        invitationLink: await buildInvitationLink({ req, workspaceId: workspace.id, invitationId: invitation.invitationId || invitation.id }),
        invitationId: invitation.invitationId || invitation.id,
      });

      try {
        await aiProvisioningService.enqueueOrgSync(organization.orgId);
        await aiProvisioningService.enqueueWorkspaceSync(workspace.id);
      } catch (error) {
        logger.error('[OrganizationController] Failed to enqueue AI provisioning jobs', {
          orgId: organization.orgId,
          workspaceId: workspace.id,
          error,
        });
      }

      res.status(201).json({
        orgId: organization.orgId,
        name: organization.name,
        description: organization.description,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        ownerEmail: ownerEmail.trim().toLowerCase(),
        invitationSent: true,
      });
    } catch (error) {
      logger.error('Error creating organization:', error);
      if (isOrganizationPolicyError(error)) {
        res.status(error.statusCode).json({
          error: error.message,
          code: error.code,
          ...(error instanceof Error && 'domain' in error ? { domain: error.domain } : {}),
          ...(error instanceof Error && 'existingOrg' in error ? { existingOrg: error.existingOrg } : {}),
        });
        return;
      }

      if (error instanceof Error && error.message.includes('already exists')) {
        res.status(409).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // GET /api/organizations - List user's organizations
  getUserOrganizations = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      

      // Get user's organization memberships
      const memberships = await this.orgMemberRepository.getUserOrgs(userId);

      // Get organization details for each membership
      const organizationsWithRole = await Promise.all(
        memberships.map(async (membership) => {
          try {
            const organization = await this.organizationRepository.findById(membership.orgId);
            if (!organization) {
              return null;
            }

            return {
              orgId: organization.orgId,
              name: organization.name,
              description: organization.description,
              createdAt: organization.createdAt,
              userRole: membership.role,
              joinedAt: membership.joinedAt,
            };
          } catch (error) {
            logger.error(`Error getting organization ${membership.orgId}:`, error);
            return null;
          }
        })
      );

      // Filter out null results
      const validOrganizations = organizationsWithRole.filter(org => org !== null);

      res.status(200).json({
        organizations: validOrganizations,
        total: validOrganizations.length,
      });
    } catch (error) {
      logger.error('Error getting user organizations:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // GET /api/organizations/{orgId} - Get organization details
  getOrganizationDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const { orgId } = req.params;
      const userId = req.user!.id;
      

      const organization = await this.organizationRepository.findById(orgId);
      if (!organization) {
        res.status(404).json({ error: 'Organization not found' });
        return;
      }

      // Check if user is organization member
      const membership = await this.orgMemberRepository.findMember(orgId, userId);
      if (!membership) {
        res.status(403).json({ error: 'Access denied - not an organization member' });
        return;
      }

      // Get organization members
      const members = await this.orgMemberRepository.getOrgMembers(orgId);

      // Get user info for each member
      const membersWithUserInfo = await Promise.all(
        members.map(async (member) => ({
          userId: member.userId,
          role: member.role,
          joinedAt: member.joinedAt,
          invitedBy: member.invitedBy,
          user: await this.getUserInfo(member.userId),
        }))
      );

      res.status(200).json({
        orgId: organization.orgId,
        name: organization.name,
        description: organization.description,
        createdBy: organization.createdBy,
        createdAt: organization.createdAt,
        userRole: membership.role,
        memberCount: membersWithUserInfo.length,
        members: membersWithUserInfo,
      });
    } catch (error) {
      logger.error('Error getting organization details:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // POST /api/organizations/{orgId}/members - Add member to organization
  addMember = async (req: Request, res: Response): Promise<void> => {
    try {
      const { orgId } = req.params;
      const { userId: targetUserId, role }: { userId: string; role: OrgRole } = req.body;
      const userId = req.user!.id;
      

      // Validate required fields
      if (!targetUserId || !role) {
        res.status(400).json({ error: 'userId and role are required' });
        return;
      }

      // Validate role
      const validRoles: OrgRole[] = [OrgRole.OWNER, OrgRole.ADMIN, OrgRole.MEMBER, OrgRole.GUEST];
      if (!validRoles.includes(role)) {
        res.status(400).json({
          error: 'Invalid role',
          validValues: validRoles
        });
        return;
      }

      const organization = await this.organizationRepository.findById(orgId);
      if (!organization) {
        res.status(404).json({ error: 'Organization not found' });
        return;
      }

      // Check if current user has permission to add members (admin or owner)
      const currentUserMembership = await this.orgMemberRepository.findMember(orgId, userId);
      if (!currentUserMembership || !['OWNER', 'ADMIN'].includes(currentUserMembership.role)) {
        res.status(403).json({ error: 'Access denied - insufficient permissions' });
        return;
      }

      // Only an existing OWNER may add a member with the OWNER role.
      if (role === 'OWNER' && currentUserMembership.role !== 'OWNER') {
        res.status(403).json({ error: 'Only an owner can assign the OWNER role' });
        return;
      }

      // Check if target user is already a member
      const existingMembership = await this.orgMemberRepository.findMember(orgId, targetUserId);
      if (existingMembership) {
        res.status(409).json({ error: 'User is already a member of this organization' });
        return;
      }

      // Add member
      await this.orgMemberRepository.create({
        orgId,
        userId: targetUserId,
        role,
        invitedBy: userId,
      });

      res.status(200).json({
        message: 'Member added successfully',
        orgId,
        userId: targetUserId,
        role,
      });
    } catch (error) {
      logger.error('Error adding organization member:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // PUT /api/organizations/{orgId}/members/{userId} - Update member role
  updateMemberRole = async (req: Request, res: Response): Promise<void> => {
    try {
      const { orgId, userId: targetUserId } = req.params;
      const { role }: { role: OrgRole } = req.body;
      const userId = req.user!.id;
      

      // Validate role
      const validRoles: OrgRole[] = [OrgRole.OWNER, OrgRole.ADMIN, OrgRole.MEMBER, OrgRole.GUEST];
      if (!role || !validRoles.includes(role)) {
        res.status(400).json({
          error: 'Invalid role',
          validValues: validRoles
        });
        return;
      }

      const organization = await this.organizationRepository.findById(orgId);
      if (!organization) {
        res.status(404).json({ error: 'Organization not found' });
        return;
      }

      // Check if current user has permission (admin or owner)
      const currentUserMembership = await this.orgMemberRepository.findMember(orgId, userId);
      if (!currentUserMembership || !['OWNER', 'ADMIN'].includes(currentUserMembership.role)) {
        res.status(403).json({ error: 'Access denied - insufficient permissions' });
        return;
      }

      // Only an existing OWNER may grant the OWNER role; an ADMIN cannot promote anyone
      // (including themselves) to OWNER.
      if (role === 'OWNER' && currentUserMembership.role !== 'OWNER') {
        res.status(403).json({ error: 'Only an owner can assign the OWNER role' });
        return;
      }
      // A member may not change their own role.
      if (targetUserId === userId && role !== currentUserMembership.role) {
        res.status(403).json({ error: 'You cannot change your own role' });
        return;
      }

      // Check if target user is a member
      const targetMembership = await this.orgMemberRepository.findMember(orgId, targetUserId);
      if (!targetMembership) {
        res.status(404).json({ error: 'User is not a member of this organization' });
        return;
      }

      // Don't allow changing the last owner's role
      if (targetMembership.role === 'OWNER' && role !== 'OWNER') {
        const allMembers = await this.orgMemberRepository.getOrgMembers(orgId);
        const ownerCount = allMembers.filter(m => m.role === 'OWNER').length;
        if (ownerCount <= 1) {
          res.status(400).json({ error: 'Cannot change role of the last owner' });
          return;
        }
      }

      // Update member role
      await this.orgMemberRepository.updateMemberRole(orgId, targetUserId, role);

      res.status(200).json({
        message: 'Member role updated successfully',
        orgId,
        userId: targetUserId,
        role,
      });
    } catch (error) {
      logger.error('Error updating member role:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // DELETE /api/organizations/{orgId}/members/{userId} - Remove member from organization
  removeMember = async (req: Request, res: Response): Promise<void> => {
    try {
      const { orgId, userId: targetUserId } = req.params;
      const userId = req.user!.id;
      

      const organization = await this.organizationRepository.findById(orgId);
      if (!organization) {
        res.status(404).json({ error: 'Organization not found' });
        return;
      }

      // Check if current user has permission (admin, owner, or removing themselves)
      const currentUserMembership = await this.orgMemberRepository.findMember(orgId, userId);
      if (!currentUserMembership) {
        res.status(403).json({ error: 'Access denied - not an organization member' });
        return;
      }

      const canRemove = ['OWNER', 'ADMIN'].includes(currentUserMembership.role) || userId === targetUserId;
      if (!canRemove) {
        res.status(403).json({ error: 'Access denied - insufficient permissions' });
        return;
      }

      // Check if target user is a member
      const targetMembership = await this.orgMemberRepository.findMember(orgId, targetUserId);
      if (!targetMembership) {
        res.status(404).json({ error: 'User is not a member of this organization' });
        return;
      }

      // Don't allow removing the last owner
      if (targetMembership.role === 'OWNER') {
        const allMembers = await this.orgMemberRepository.getOrgMembers(orgId);
        const ownerCount = allMembers.filter(m => m.role === 'OWNER').length;
        if (ownerCount <= 1) {
          res.status(400).json({ error: 'Cannot remove the last owner from the organization' });
          return;
        }
      }

      // Remove member
      await this.orgMemberRepository.removeMember(orgId, targetUserId);

      res.status(200).json({
        message: 'Member removed successfully',
        orgId,
        userId: targetUserId,
      });
    } catch (error) {
      logger.error('Error removing organization member:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
