import { Request, Response } from 'express';
import { OrganizationRepository, CreateOrganizationInput } from '../database/repositories/organizationRepository';
import { UserRepository } from '../database/repositories/users';
import { OrgRole } from '@prisma/client';
import { DatabaseClient } from '../database/client';
import {logger} from '@/utils/logger';

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

  // POST /api/organizations - Create new organization
  createOrganization = async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        name,
        description,
      }: {
        name: string;
        description?: string;
      } = req.body;

      const userId = req.user!.id;
      

      // Validate required fields
      if (!name || name.trim() === '') {
        res.status(400).json({ error: 'Organization name is required' });
        return;
      }

      // Check if organization name already exists
      const existingOrg = await this.organizationRepository.findByName(name.trim());
      if (existingOrg) {
        res.status(409).json({ error: 'Organization name already exists' });
        return;
      }

      // Create organization
      const orgData: CreateOrganizationInput = {
        name: name.trim(),
        description: description?.trim(),
        createdBy: userId,
      };

      const organization = await this.organizationRepository.create(orgData);

      // Add creator as organization owner
      await this.orgMemberRepository.create({
        orgId: organization.orgId,
        userId,
        role: 'OWNER',
      });

      res.status(201).json({
        orgId: organization.orgId,
        name: organization.name,
        description: organization.description,
        createdBy: organization.createdBy,
        createdAt: organization.createdAt,
      });
    } catch (error) {
      logger.error('Error creating organization:', error);
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
      const validRoles: OrgRole[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'];
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
      const validRoles: OrgRole[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'];
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