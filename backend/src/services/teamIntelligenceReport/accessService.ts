import { OrgRole } from '@prisma/client';
import { config } from '@/config/env';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import type { TeamIntelligenceMember } from './types';

const teamIntelligenceAccessLogger = logger.child({
  module: 'team-intelligence-access',
});

const MANAGER_ROLES: OrgRole[] = ['OWNER', 'ADMIN'];
const DEV_ROLE_BYPASS_ENABLED =
  config.env === 'development' && process.env.ENABLE_DEV_AUTH === 'true';

export interface TeamIntelligenceScope {
  orgId: string;
  orgName: string;
  requesterRole: 'admin' | OrgRole;
  members: TeamIntelligenceMember[];
}

export class TeamIntelligenceAccessService {
  async assertCanAccessOrgScope(
    requesterUserId: string,
    requesterAppRole: 'admin' | 'user' | undefined,
    orgId: string
  ): Promise<TeamIntelligenceScope> {
    const organization = await db.organization.findUnique({
      where: { orgId },
      select: {
        orgId: true,
        name: true,
      },
    });

    if (!organization) {
      throw new Error('Organization not found');
    }

    const membership = await db.orgMember.findUnique({
      where: {
        orgId_userId: {
          orgId,
          userId: requesterUserId,
        },
      },
    });

    if (requesterAppRole !== 'admin') {
      if (!membership) {
        throw new Error('Forbidden: not an organization member');
      }

      if (!MANAGER_ROLES.includes(membership.role)) {
        if (!DEV_ROLE_BYPASS_ENABLED) {
          throw new Error('Forbidden: insufficient organization permissions');
        }

        teamIntelligenceAccessLogger.warn(
          '[TEAM_INTELLIGENCE] Dev-mode role bypass applied for report access',
          {
            orgId,
            requesterUserId,
            membershipRole: membership.role,
          }
        );
      }
    }

    const members = await this.getOrgMembers(orgId);

    return {
      orgId: organization.orgId,
      orgName: organization.name,
      requesterRole: requesterAppRole === 'admin' ? 'admin' : (membership?.role || 'MEMBER'),
      members,
    };
  }

  async resolveRequestedMembers(
    orgId: string,
    requestedUserIds?: string[]
  ): Promise<TeamIntelligenceMember[]> {
    const members = await this.getOrgMembers(orgId);
    if (!requestedUserIds || requestedUserIds.length === 0) {
      return members;
    }

    const requestedSet = new Set(requestedUserIds);
    const resolved = members.filter(member => requestedSet.has(member.userId));
    const missingUserIds = requestedUserIds.filter(
      userId => !resolved.some(member => member.userId === userId)
    );

    if (missingUserIds.length > 0) {
      teamIntelligenceAccessLogger.warn(
        '[TEAM_INTELLIGENCE] Requested users outside org scope',
        { orgId, missingUserIds }
      );
      throw new Error('One or more requested users are outside the organization scope');
    }

    return resolved;
  }

  private async getOrgMembers(orgId: string): Promise<TeamIntelligenceMember[]> {
    const memberships = await db.orgMember.findMany({
      where: { orgId },
      orderBy: [
        { role: 'asc' },
        { joinedAt: 'asc' },
      ],
    });

    const users = await db.user.findMany({
      where: {
        id: {
          in: memberships.map(membership => membership.userId),
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    const userMap = new Map(
      users.map(user => [
        user.id,
        {
          name: user.name,
          email: user.email,
        },
      ])
    );

    return memberships
      .filter(membership => Boolean(userMap.get(membership.userId)?.email))
      .map(membership => ({
        userId: membership.userId,
        name:
          userMap.get(membership.userId)?.name ||
          userMap.get(membership.userId)?.email ||
          membership.userId,
        email: userMap.get(membership.userId)?.email || '',
        orgRole: membership.role,
      }));
  }
}

export const teamIntelligenceAccessService = new TeamIntelligenceAccessService();
