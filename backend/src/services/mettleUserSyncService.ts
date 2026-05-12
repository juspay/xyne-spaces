import { UserStatus } from '@prisma/client';
import { db } from '@/database/client';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { UserService } from '@/services/userService';

export interface MettleSubteam {
  id: string;
  name: string;
}

export interface MettleTeam {
  id: string;
  name: string;
}

export interface MettleEmployee {
  assigned_emp_id?: string;
  business_category?: string;
  business_country?: string;
  business_region?: string;
  category?: string;
  conversion_date?: string | null;
  deactivated_date?: string | null;
  designation?: string;
  doj?: string | null;
  email?: string;
  employement_type?: string;
  id?: string;
  last_working_day?: string | null;
  location?: string;
  name?: string;
  product_manager_email?: string;
  project_manager?: string;
  project_manager_id?: string;
  role?: string;
  segment?: string;
  subsegment?: string;
  subteams?: MettleSubteam[];
  team?: MettleTeam;
  phone?: string;
  userStatus?: string;
}

export type MettleUserSyncPayload = MettleEmployee;

interface MettleUserSyncSummary {
  totalEmployeesReceived: number;
  processedEmployees: number;
  updatedUsers: number;
  createdUsers: number;
  skippedEmployees: number;
  unmatchedEmployeeEmails: string[];
  skippedReasons: Array<{ email: string; reason: string }>;
}

function normalizeEmail(email?: string): string {
  return (email ?? '').trim().toLowerCase();
}

function parseDate(value?: string | null): Date | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed;
}

function parseUserStatus(value?: string | null): UserStatus | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === 'ACTIVE') {
    return UserStatus.ACTIVE;
  }
  if (normalized === 'INACTIVE') {
    return UserStatus.INACTIVE;
  }

  return undefined;
}

type UserProfileSyncData = {
  phoneNumber?: string;
  team?: string;
  role?: string;
  manager?: string;
  joinedOn?: Date;
};

function buildUserProfileData(employee: MettleEmployee, managerUserId?: string): UserProfileSyncData {
  const joinedOn = parseDate(employee.doj);

  return {
    ...(employee.phone ? { phoneNumber: employee.phone } : {}),
    ...(employee.team?.name ? { team: employee.team.name } : {}),
    ...(employee.designation ? { role: employee.designation } : {}),
    ...(managerUserId ? { manager: managerUserId } : {}),
    ...(joinedOn ? { joinedOn } : {}),
  };
}

type UserIdentity = {
  id: string;
  email: string;
  name: string;
  displayName: string | null;
};

type EnsureUserOptions = {
  email: string;
  name?: string;
  providerUserId?: string;
  status?: UserStatus;
  workspaceId: string;
};

export class MettleUserSyncService {
  private userService = new UserService();

  private async ensureUserByEmail(options: EnsureUserOptions): Promise<UserIdentity | undefined> {
    const { email, name, providerUserId, status, workspaceId } = options;

    const existingUser = await db.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: 'insensitive',
        },
        workspaceId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        displayName: true,
      },
    });

    if (existingUser) {
      return existingUser;
    }

    const orgMember = await db.orgMember.findUnique({
      where: { email },
      select: { memberId: true },
    });

    if (!orgMember) {
      return undefined;
    }

    const createdUser = await this.userService.createUser(
      {
        provider: 'API_KEY',
        providerUserId: providerUserId ?? `mettle_${Buffer.from(email).toString('base64')}`,
        email,
        name: name ?? email,
      },
      workspaceId
    );

    const updatedUser = await db.user.update({
      where: { id: createdUser.id },
      data: {
        ...(name ? { displayName: name } : {}),
        ...(status ? { status } : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        displayName: true,
      },
    });

    return updatedUser;
  }

  async syncUsers(payload: MettleUserSyncPayload): Promise<MettleUserSyncSummary> {
    const summary: MettleUserSyncSummary = {
      totalEmployeesReceived: 1,
      processedEmployees: 0,
      updatedUsers: 0,
      createdUsers: 0,
      skippedEmployees: 0,
      unmatchedEmployeeEmails: [],
      skippedReasons: [],
    };

    const employee = payload;
    const email = normalizeEmail(employee.email);
    if (!email) {
      summary.skippedEmployees += 1;
      summary.skippedReasons.push({ email: '', reason: 'missing_email' });
      return summary;
    }

    summary.processedEmployees += 1;

    const workspaceId = config.defaultWorkspaceId;
    if (!workspaceId) {
      summary.skippedEmployees += 1;
      summary.skippedReasons.push({ email, reason: 'default_workspace_id_not_configured' });
      return summary;
    }

    const users = await db.user.findMany({
      where: {
        email: {
          equals: email,
          mode: 'insensitive',
        },
        workspaceId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        displayName: true,
      },
    });

    let managerUserId: string | undefined;
    const managerEmail = normalizeEmail(employee.product_manager_email);
    if (managerEmail) {
      const managerUser = await this.ensureUserByEmail({
        email: managerEmail,
        name: employee.project_manager,
        workspaceId,
      });
      managerUserId = managerUser?.id;
    }

    if (!users.length) {
      const userStatus = parseUserStatus(employee.userStatus);
      const ensuredUser = await this.ensureUserByEmail({
        email,
        name: employee.name,
        status: userStatus,
        workspaceId,
      });

      if (!ensuredUser) {
        summary.skippedEmployees += 1;
        summary.unmatchedEmployeeEmails.push(email);
        summary.skippedReasons.push({ email, reason: 'org_member_not_found' });
        return summary;
      }

      const userProfileData = buildUserProfileData(employee, managerUserId);
      if (Object.keys(userProfileData).length > 0) {
        await db.userProfile.upsert({
          where: { userId: ensuredUser.id },
          create: {
            userId: ensuredUser.id,
            ...userProfileData,
          },
          update: userProfileData,
        });
      }

      summary.createdUsers += 1;
      return summary;
    }

    for (const user of users) {
      const userProfileData = buildUserProfileData(employee, managerUserId);
      const userStatus = parseUserStatus(employee.userStatus);
      const hasUserNameUpdate = Boolean(employee.name);
      const hasUserStatusUpdate = Boolean(userStatus);
      const hasUserProfileUpdate = Object.keys(userProfileData).length > 0;

      if (hasUserNameUpdate || hasUserStatusUpdate) {
        await db.user.update({
          where: { id: user.id },
          data: {
            ...(hasUserNameUpdate ? { name: employee.name, displayName: employee.name } : {}),
            ...(hasUserStatusUpdate ? { status: userStatus } : {}),
          },
        });
      }

      if (Object.keys(userProfileData).length > 0) {
        await db.userProfile.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            ...userProfileData,
          },
          update: userProfileData,
        });
      }

      if (hasUserNameUpdate || hasUserStatusUpdate || hasUserProfileUpdate) {
        summary.updatedUsers += 1;
      }
    }

    logger.info('[Mettle User Sync] User sync completed', {
      totalEmployeesReceived: summary.totalEmployeesReceived,
      processedEmployees: summary.processedEmployees,
      updatedUsers: summary.updatedUsers,
      createdUsers: summary.createdUsers,
      skippedEmployees: summary.skippedEmployees,
      unmatchedEmployeeCount: summary.unmatchedEmployeeEmails.length,
    });

    return summary;
  }
}

export const mettleUserSyncService = new MettleUserSyncService();
