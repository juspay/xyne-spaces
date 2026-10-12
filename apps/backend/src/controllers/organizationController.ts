import { Request, Response } from 'express';
import { OrganizationRepository } from '../database/repositories/organizationRepository';
import { DatabaseClient } from '../database/client';
import { logger } from '@/utils/logger';
import { invitationService } from '@/services/invitationService';
import { OrgRole } from '@xyne/shared';
import { aiProvisioningService } from '@/services/aiProvisioningService';
import { isOrganizationPolicyError, organizationDomainService } from '@/services/organizationDomainService';
import { buildInvitationLink } from '@/controllers/invitationController';
import { getEncryptionProvider } from '@/services/encryption';
import { createId } from '@paralleldrive/cuid2';
import { createOrganizationWithWorkspace, createOwnerInvitation } from '@/bypassAcl/orgServices';

// OrgMember identity is `memberId` (one row per email). The legacy `userId` column is
// deprecated and always holds the literal "deprecated", so every lookup below is keyed
// on (orgId, memberId) and ignores members who have left (`leftAt` set).
interface OrgMember {
  memberId: string;
  orgId: string;
  email: string;
  role: OrgRole;
  joinedAt: Date;
  invitedBy?: string | null;
}

class OrgMemberRepository {
  private db: any;

  constructor() {
    this.db = DatabaseClient.getInstance();
  }

  async findMember(orgId: string, memberId: string): Promise<OrgMember | null> {
    if (!memberId) return null;
    return await this.db.orgMember.findFirst({
      where: { orgId, memberId, leftAt: null },
    });
  }

  async getOrgMembers(orgId: string): Promise<OrgMember[]> {
    return await this.db.orgMember.findMany({
      where: { orgId, leftAt: null },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async getMemberOrgs(memberId: string): Promise<OrgMember[]> {
    if (!memberId) return [];
    return await this.db.orgMember.findMany({
      where: { memberId, leftAt: null },
      orderBy: { joinedAt: 'desc' },
    });
  }

  async removeMember(orgId: string, memberId: string): Promise<void> {
    await this.db.orgMember.updateMany({
      where: { orgId, memberId, leftAt: null },
      data: { leftAt: new Date() },
    });
  }

  async updateMemberRole(orgId: string, memberId: string, role: OrgRole): Promise<void> {
    await this.db.orgMember.updateMany({
      where: { orgId, memberId, leftAt: null },
      data: { role },
    });
  }
}

const isOrgAdminRole = (role: string | undefined | null): boolean =>
  role === OrgRole.OWNER || role === OrgRole.ADMIN;

export class OrganizationController {
  private organizationRepository: OrganizationRepository;
  private orgMemberRepository: OrgMemberRepository;

  constructor() {
    this.organizationRepository = new OrganizationRepository();
    this.orgMemberRepository = new OrgMemberRepository();
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

      // Security (bug bounty #36): creating an organization provisions a new tenant and
      // emails an OWNER invitation to `ownerEmail`. Previously any authenticated
      // non-guest user could do this for an arbitrary address, i.e. send official
      // Xyne invitation mail to anyone and pre-claim another company's email domain
      // (createDomainMappingForOrg). Restrict this to org/workspace OWNER or ADMIN —
      // the same bar as POST /api/invitations/provision-org.
      if (!isOrgAdminRole(req.user?.orgRole) && !isOrgAdminRole(req.user?.role)) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Only organization or workspace admins can create organizations',
        });
        return;
      }

      const normalizedOwnerEmail = ownerEmail.trim().toLowerCase();
      await organizationDomainService.assertCanCreateOrgForEmail(normalizedOwnerEmail);

      // OrgMember.email is globally unique — reject owners who already belong to an
      // organization instead of failing later inside the transaction.
      const existingOwnerMembership = await db.orgMember.findFirst({
        where: { email: normalizedOwnerEmail, leftAt: null },
        select: { orgId: true },
      });
      if (existingOwnerMembership) {
        res.status(409).json({ error: `${ownerEmail.trim()} is already a member of an organization` });
        return;
      }

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

      const { organization, workspace } = await createOrganizationWithWorkspace(
        orgId,
        name,
        description,
        userId,
        workspaceName,
        ownerEmail,
      );

      await organizationDomainService.createDomainMappingForOrg({
        orgId: organization.orgId,
        email: ownerEmail.trim(),
        verifiedByUserId: userId,
      });

      const invitation = await createOwnerInvitation(ownerEmail, workspace.id, userId, organization.orgId);

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
      // Get the caller's organization memberships (keyed on OrgMember.memberId)
      const memberships = await this.orgMemberRepository.getMemberOrgs(req.user!.memberId);

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

      const organization = await this.organizationRepository.findById(orgId);
      if (!organization) {
        res.status(404).json({ error: 'Organization not found' });
        return;
      }

      // Check if user is organization member
      const membership = await this.orgMemberRepository.findMember(orgId, req.user!.memberId);
      if (!membership) {
        res.status(403).json({ error: 'Access denied - not an organization member' });
        return;
      }

      // Get organization members
      const members = await this.orgMemberRepository.getOrgMembers(orgId);

      // Get user info for each member
      const membersWithUserInfo = await Promise.all(
        members.map(async (member) => ({
          memberId: member.memberId,
          email: member.email,
          role: member.role,
          joinedAt: member.joinedAt,
          invitedBy: member.invitedBy,
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
  // OrgMember rows are keyed on email and created through the invitation flow
  // (invitationService), which verifies the invitee owns the address. Direct inserts
  // by id would bypass that, so this endpoint is intentionally disabled.
  addMember = async (_req: Request, res: Response): Promise<void> => {
    res.status(410).json({
      error: 'Gone',
      message: 'Add organization members by sending an invitation instead',
    });
  };

  // PUT /api/organizations/{orgId}/members/{userId} - Update member role
  updateMemberRole = async (req: Request, res: Response): Promise<void> => {
    try {
      const { orgId, userId: targetMemberId } = req.params;
      const { role }: { role: OrgRole } = req.body;
      const callerMemberId = req.user!.memberId;

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
      const currentUserMembership = await this.orgMemberRepository.findMember(orgId, callerMemberId);
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
      if (targetMemberId === callerMemberId && role !== currentUserMembership.role) {
        res.status(403).json({ error: 'You cannot change your own role' });
        return;
      }

      // Check if target user is a member
      const targetMembership = await this.orgMemberRepository.findMember(orgId, targetMemberId);
      if (!targetMembership) {
        res.status(404).json({ error: 'User is not a member of this organization' });
        return;
      }

      // An ADMIN may not demote or otherwise modify an OWNER.
      if (targetMembership.role === OrgRole.OWNER && currentUserMembership.role !== OrgRole.OWNER) {
        res.status(403).json({ error: 'Only an owner can change the role of another owner' });
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
      await this.orgMemberRepository.updateMemberRole(orgId, targetMemberId, role);

      res.status(200).json({
        message: 'Member role updated successfully',
        orgId,
        memberId: targetMemberId,
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
      const { orgId, userId: targetMemberId } = req.params;
      const callerMemberId = req.user!.memberId;

      const organization = await this.organizationRepository.findById(orgId);
      if (!organization) {
        res.status(404).json({ error: 'Organization not found' });
        return;
      }

      // Check if current user has permission (admin, owner, or removing themselves)
      const currentUserMembership = await this.orgMemberRepository.findMember(orgId, callerMemberId);
      if (!currentUserMembership) {
        res.status(403).json({ error: 'Access denied - not an organization member' });
        return;
      }

      const canRemove = isOrgAdminRole(currentUserMembership.role) || callerMemberId === targetMemberId;
      if (!canRemove) {
        res.status(403).json({ error: 'Access denied - insufficient permissions' });
        return;
      }

      // Check if target user is a member
      const targetMembership = await this.orgMemberRepository.findMember(orgId, targetMemberId);
      if (!targetMembership) {
        res.status(404).json({ error: 'User is not a member of this organization' });
        return;
      }

      // An ADMIN may not remove an OWNER (owners may still leave themselves).
      if (
        targetMembership.role === OrgRole.OWNER &&
        currentUserMembership.role !== OrgRole.OWNER &&
        callerMemberId !== targetMemberId
      ) {
        res.status(403).json({ error: 'Only an owner can remove another owner' });
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
      await this.orgMemberRepository.removeMember(orgId, targetMemberId);

      res.status(200).json({
        message: 'Member removed successfully',
        orgId,
        memberId: targetMemberId,
      });
    } catch (error) {
      logger.error('Error removing organization member:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
