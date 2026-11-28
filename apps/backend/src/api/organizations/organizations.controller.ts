import { OrgRole, api } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { OrganizationRepository } from '@/database/repositories/organizationRepository';
import { UserRepository } from '@/database/repositories/users';
import { ContractError, controller } from '@/framework/api';
import { syncOrgResourceAdminAccess } from '@/services/permissionMatrix';
import type { AuthenticatedUser } from '@/types/express';
import { logger } from '@/utils/logger';

/**
 * Organization membership on the typed framework (routes/organizations.ts): no req/res, same
 * rules and answers as the OrganizationController methods they replace.
 */

interface OrgMember {
  memberId: string;
  orgId: string;
  userId: string;
  email: string;
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

/** Org memberships (the controller's own small repository, moved here with its handlers). */
class OrgMemberRepository {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any = DatabaseClient.getInstance();

  create(data: CreateOrgMemberInput): Promise<OrgMember> {
    return this.db.orgMember.create({ data });
  }
  findMember(orgId: string, userId: string): Promise<OrgMember | null> {
    return this.db.orgMember.findUnique({ where: { orgId_userId: { orgId, userId } } });
  }
  getOrgMembers(orgId: string): Promise<OrgMember[]> {
    return this.db.orgMember.findMany({ where: { orgId }, orderBy: { joinedAt: 'asc' } });
  }
  getUserOrgs(userId: string): Promise<OrgMember[]> {
    return this.db.orgMember.findMany({ where: { userId }, orderBy: { joinedAt: 'desc' } });
  }
  async removeMember(orgId: string, userId: string): Promise<void> {
    await this.db.orgMember.delete({ where: { orgId_userId: { orgId, userId } } });
  }
  updateMemberRole(orgId: string, userId: string, role: OrgRole): Promise<OrgMember> {
    return this.db.orgMember.update({ where: { orgId_userId: { orgId, userId } }, data: { role } });
  }
}

const organizationRepository = new OrganizationRepository();
const orgMemberRepository = new OrgMemberRepository();
const userRepository = new UserRepository();

const internal = (error: unknown, logMessage: string) => {
  if (error instanceof ContractError) return error;
  logger.error(logMessage, error);
  return new ContractError(500, { error: 'Internal server error' });
};
const userIdOf = (user: AuthenticatedUser | undefined) => user!.id;
const isAdminOrOwner = (role: string) => ['OWNER', 'ADMIN'].includes(role);

async function getUserInfo(userId: string) {
  try {
    const user = await userRepository.findById(userId);
    if (user) return { id: user.id, name: user.name, email: user.email };
  } catch (error) {
    logger.warn(`Failed to lookup user ${userId}:`, error);
  }
  return { id: userId, name: 'User', email: 'user@example.com' };
}

async function requireOrganization(orgId: string) {
  const organization = await organizationRepository.findById(orgId);
  if (!organization) throw new ContractError(404, { error: 'Organization not found' });
  return organization;
}

/** GET /organizations: the caller's organizations, with their role in each. */
export const listOrganizations = controller(api.organizations.list, async (input) => {
  try {
    const memberships = await orgMemberRepository.getUserOrgs(userIdOf(input.user));
    const withRole = await Promise.all(
      memberships.map(async (membership) => {
        try {
          const organization = await organizationRepository.findById(membership.orgId);
          if (!organization) return null;
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
      }),
    );
    const organizations = withRole.filter((org): org is NonNullable<typeof org> => org !== null);
    return { organizations, total: organizations.length };
  } catch (error) {
    throw internal(error, 'Error getting user organizations:');
  }
});

/** GET /organizations/:orgId: members only. */
export const getOrganization = controller(api.organizations.get, async (input) => {
  try {
    const { orgId } = input.params;
    const organization = await requireOrganization(orgId);
    const membership = await orgMemberRepository.findMember(orgId, userIdOf(input.user));
    if (!membership) throw new ContractError(403, { error: 'Access denied - not an organization member' });

    const members = await orgMemberRepository.getOrgMembers(orgId);
    const membersWithUserInfo = await Promise.all(
      members.map(async (member) => ({
        userId: member.userId,
        role: member.role,
        joinedAt: member.joinedAt,
        invitedBy: member.invitedBy,
        user: await getUserInfo(member.userId),
      })),
    );
    return {
      orgId: organization.orgId,
      name: organization.name,
      description: organization.description,
      createdBy: organization.createdBy,
      createdAt: organization.createdAt,
      userRole: membership.role,
      memberCount: membersWithUserInfo.length,
      members: membersWithUserInfo,
    };
  } catch (error) {
    throw internal(error, 'Error getting organization details:');
  }
});

/** POST /organizations/:orgId/members: an owner or admin adds a member; only an owner can add an owner. */
export const addMember = controller(api.organizations.addMember, async (input) => {
  try {
    const { orgId } = input.params;
    const { userId: targetUserId, role } = input.body;
    const userId = userIdOf(input.user);
    await requireOrganization(orgId);

    const current = await orgMemberRepository.findMember(orgId, userId);
    if (!current || !isAdminOrOwner(current.role)) throw new ContractError(403, { error: 'Access denied - insufficient permissions' });
    // Only an existing OWNER may add a member with the OWNER role.
    if (role === 'OWNER' && current.role !== 'OWNER') throw new ContractError(403, { error: 'Only an owner can assign the OWNER role' });
    if (await orgMemberRepository.findMember(orgId, targetUserId)) {
      throw new ContractError(409, { error: 'User is already a member of this organization' });
    }
    await orgMemberRepository.create({ orgId, userId: targetUserId, role: role as OrgRole, invitedBy: userId });
    return { message: 'Member added successfully', orgId, userId: targetUserId, role };
  } catch (error) {
    throw internal(error, 'Error adding organization member:');
  }
});

/** PUT /organizations/:orgId/members/:userId: change a role. */
export const updateMemberRole = controller(api.organizations.updateMemberRole, async (input) => {
  try {
    const { orgId, userId: targetUserId } = input.params;
    const { role } = input.body;
    const userId = userIdOf(input.user);
    await requireOrganization(orgId);

    const current = await orgMemberRepository.findMember(orgId, userId);
    if (!current || !isAdminOrOwner(current.role)) throw new ContractError(403, { error: 'Access denied - insufficient permissions' });
    // Only an existing OWNER may grant the OWNER role; an ADMIN cannot promote anyone (including
    // themselves) to OWNER.
    if (role === 'OWNER' && current.role !== 'OWNER') throw new ContractError(403, { error: 'Only an owner can assign the OWNER role' });
    // A member may not change their own role.
    if (targetUserId === userId && role !== current.role) throw new ContractError(403, { error: 'You cannot change your own role' });

    const target = await orgMemberRepository.findMember(orgId, targetUserId);
    if (!target) throw new ContractError(404, { error: 'User is not a member of this organization' });
    // Don't allow changing the last owner's role
    if (target.role === 'OWNER' && role !== 'OWNER') {
      const owners = (await orgMemberRepository.getOrgMembers(orgId)).filter((m) => m.role === 'OWNER').length;
      if (owners <= 1) throw new ContractError(400, { error: 'Cannot change role of the last owner' });
    }
    await orgMemberRepository.updateMemberRole(orgId, targetUserId, role as OrgRole);
    // Reconcile resource access for the new org role (error-swallowing, so never fails the request)
    await syncOrgResourceAdminAccess(orgId, target.email, userId);
    return { message: 'Member role updated successfully', orgId, userId: targetUserId, role };
  } catch (error) {
    throw internal(error, 'Error updating member role:');
  }
});

/** DELETE /organizations/:orgId/members/:userId: an owner or admin removes anyone; anyone may leave. */
export const removeMember = controller(api.organizations.removeMember, async (input) => {
  try {
    const { orgId, userId: targetUserId } = input.params;
    const userId = userIdOf(input.user);
    await requireOrganization(orgId);

    const current = await orgMemberRepository.findMember(orgId, userId);
    if (!current) throw new ContractError(403, { error: 'Access denied - not an organization member' });
    if (!(isAdminOrOwner(current.role) || userId === targetUserId)) {
      throw new ContractError(403, { error: 'Access denied - insufficient permissions' });
    }
    const target = await orgMemberRepository.findMember(orgId, targetUserId);
    if (!target) throw new ContractError(404, { error: 'User is not a member of this organization' });
    // Don't allow removing the last owner
    if (target.role === 'OWNER') {
      const owners = (await orgMemberRepository.getOrgMembers(orgId)).filter((m) => m.role === 'OWNER').length;
      if (owners <= 1) throw new ContractError(400, { error: 'Cannot remove the last owner from the organization' });
    }
    await orgMemberRepository.removeMember(orgId, targetUserId);
    return { message: 'Member removed successfully', orgId, userId: targetUserId };
  } catch (error) {
    throw internal(error, 'Error removing organization member:');
  }
});