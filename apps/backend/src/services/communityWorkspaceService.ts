import { User } from '@prisma/client';
import { CommunityJoinResultStatus,
  type CommunityJoinResultStatus as CommunityJoinResultStatusType,
  ChannelRole,
  OrgRole,
  WorkspaceJoinPolicy,
  WorkspaceJoinRequestAction,
  type WorkspaceJoinRequestAction as WorkspaceJoinRequestActionType,
  WorkspaceJoinRequestStatus,
  type WorkspaceJoinRequestStatus as WorkspaceJoinRequestStatusType,
  WorkspaceType,
  AuthProvider,
  Status,
  UserStatus,
  WorkspaceRole } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { emailService } from '@/services/email/factory';
import { communityJoinApprovedEmailHtml } from '@/services/email/templates/community-join-approved';
import { grantPermissionsForRole } from '@/services/permissionMatrix';
import { aiProvisioningService } from '@/services/aiProvisioningService';
import { organizationDomainService } from '@/services/organizationDomainService';
import { repositories } from '@/database/repositories';
import { ensureUserInGeneralChannel as joinUserToGeneralChannel } from '@/utils/workspaceGeneralChannel';
import { withWorkspaceScope } from '@/database/tenant/context';
import { UserService } from '@/services/userService';

const COMMUNITY_MEMBER_WORKSPACE_ROLE = 'COMMUNITY_MEMBER' as WorkspaceRole;
const TEMPLATE_TOKEN_PATTERN = /{{\s*(workspaceName|workspaceId|joinLink|email)\s*}}/g;

export interface CommunityJoinUserData {
  providerUserId: string;
  email: string;
  name: string;
  picture?: string | null;
  authProvider: string;
}

export interface CommunityJoinResult {
  workspaceUser?: User;
  isNewUser?: boolean;
  landingChannelId: string | null;
  status: CommunityJoinResultStatusType;
  joinRequest?: {
    id: string;
    status: WorkspaceJoinRequestStatusType;
    isExisting: boolean;
  };
}

export interface CommunityWorkspaceListItem {
  id: string;
  name: string;
  description: string | null;
  joinPolicy: string | null;
  landingChannelId: string | null;
}

export interface CommunityWorkspaceOrganization {
  orgId: string;
  orgName: string;
  workspaces: CommunityWorkspaceListItem[];
}

export interface CommunityJoinRequestListItem {
  id: string;
  workspaceId: string;
  email: string;
  status: string;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  workspaceName?: string;
  workspaceType?: string | null;
}

type CommunityWorkspace = {
  id: string;
  name: string;
  orgId: string;
  status: string;
  workspaceType: string | null;
  joinPolicy: string | null;
  landingChannelId: string | null;
};

export class CommunityWorkspaceService {
  private prisma = DatabaseClient.getInstance();
  private userService = new UserService();

  async listCommunityWorkspaces(): Promise<CommunityWorkspaceOrganization[]> {
    const organizations = await this.prisma.organization.findMany({
      where: {
        status: Status.ACTIVE,
        workspaces: {
          some: {
            status: Status.ACTIVE,
            workspaceType: WorkspaceType.COMMUNITY,
          },
        },
      },
      orderBy: { name: 'asc' },
      select: {
        orgId: true,
        name: true,
        workspaces: {
          where: {
            status: Status.ACTIVE,
            workspaceType: WorkspaceType.COMMUNITY,
          },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            description: true,
            joinPolicy: true,
            landingChannelId: true,
          },
        },
      },
    });

    return organizations
      .map((org) => ({
        orgId: org.orgId,
        orgName: org.name,
        workspaces: org.workspaces,
      }))
      .filter((org) => org.workspaces.length > 0);
  }

  async joinCommunityWorkspace(params: {
    workspaceId: string;
    channelId?: string;
    workspaceType?: string;
    userData: CommunityJoinUserData;
  }): Promise<CommunityJoinResult> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: params.workspaceId },
      select: {
        id: true,
        name: true,
        orgId: true,
        status: true,
        workspaceType: true,
        joinPolicy: true,
        landingChannelId: true,
      },
    });

    if (!workspace || workspace.status !== 'ACTIVE') {
      this.raise('Workspace not found', 404);
    }

    if (params.workspaceType === WorkspaceType.ENTERPRISE) {
      return this.requestEnterpriseWorkspaceJoin({
        workspace,
        userData: params.userData,
      });
    }

    if (workspace.workspaceType !== WorkspaceType.COMMUNITY) {
      this.raise('Workspace is not a community workspace', 400);
    }

    switch (workspace.joinPolicy) {
      case WorkspaceJoinPolicy.OPEN:
        return this.joinOpenCommunityWorkspace({
          workspace,
          channelId: params.channelId,
          userData: params.userData,
        });
      case WorkspaceJoinPolicy.REQUEST_TO_JOIN:
        return this.joinRequestCommunityWorkspace({
          workspace,
          channelId: params.channelId,
          userData: params.userData,
        });
      case WorkspaceJoinPolicy.INVITE_ONLY:
      default:
        this.raise('Community workspace is not open to join', 403);
    }
  }

  private async requestEnterpriseWorkspaceJoin(params: {
    workspace: CommunityWorkspace;
    userData: CommunityJoinUserData;
  }): Promise<CommunityJoinResult> {
    if (
      params.workspace.workspaceType !== WorkspaceType.ENTERPRISE &&
      params.workspace.workspaceType !== null
    ) {
      this.raise('Workspace is not an enterprise workspace', 400);
    }

    const email = params.userData.email;
    if (!organizationDomainService.shouldLookupDomain(email)) {
      this.raise('Public email domains cannot join enterprise workspaces. Please use your work email.', 403);
    }

    const existingOrg = await organizationDomainService.findExistingOrgByEmailDomain(email);
    if (!existingOrg || existingOrg.orgId !== params.workspace.orgId) {
      this.raise('Email domain is not allowed to request access to this workspace', 403);
    }

    const existingUser = await this.prisma.user.findUnique({
      where: {
        email_workspaceId: {
          email,
          workspaceId: params.workspace.id,
        },
      },
      select: { id: true, leftAt: true },
    });

    if (existingUser && !existingUser.leftAt) {
      this.raise('You already have access to this workspace', 409);
    }

    const latestRequest = await this.prisma.workspaceJoinRequest.findFirst({
      where: {
        workspaceId: params.workspace.id,
        email,
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (latestRequest?.status === WorkspaceJoinRequestStatus.PENDING) {
      return {
        status: CommunityJoinResultStatus.REQUEST_PENDING,
        landingChannelId: null,
        joinRequest: {
          id: latestRequest.id,
          status: WorkspaceJoinRequestStatus.PENDING,
          isExisting: true,
        },
      };
    }

    if (latestRequest?.status === WorkspaceJoinRequestStatus.REJECTED) {
      return {
        status: CommunityJoinResultStatus.REQUEST_REJECTED,
        landingChannelId: null,
        joinRequest: {
          id: latestRequest.id,
          status: WorkspaceJoinRequestStatus.REJECTED,
          isExisting: true,
        },
      };
    }

    if (latestRequest?.status === WorkspaceJoinRequestStatus.APPROVED) {
      return {
        status: CommunityJoinResultStatus.REQUEST_PENDING,
        landingChannelId: null,
        joinRequest: {
          id: latestRequest.id,
          status: WorkspaceJoinRequestStatus.APPROVED,
          isExisting: true,
        },
      };
    }

    const joinRequest = await this.prisma.workspaceJoinRequest.create({
      data: {
        workspaceId: params.workspace.id,
        email,
        status: WorkspaceJoinRequestStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    logger.info('[CommunityWorkspaceService] Created enterprise workspace join request', {
      email,
      workspaceId: params.workspace.id,
      orgId: existingOrg.orgId,
      requestId: joinRequest.id,
    });

    return {
      status: CommunityJoinResultStatus.REQUEST_PENDING,
      landingChannelId: null,
      joinRequest: {
        id: joinRequest.id,
        status: WorkspaceJoinRequestStatus.PENDING,
        isExisting: false,
      },
    };
  }

  private async joinOpenCommunityWorkspace(params: {
    workspace: CommunityWorkspace;
    channelId?: string;
    userData: CommunityJoinUserData;
  }): Promise<CommunityJoinResult> {
    const email = params.userData.email;
    const normalizedAuthProvider =
      (params.userData.authProvider?.toUpperCase() as AuthProvider) || AuthProvider.GOOGLE;

    const requestedChannel = params.channelId
      ? await this.prisma.channel.findFirst({
          where: {
            id: params.channelId,
            workspaceId: params.workspace.id,
            isArchived: false,
          },
          select: { id: true },
        })
      : null;

    const landingChannelId = requestedChannel?.id ?? params.workspace.landingChannelId ?? null;

    const result = await this.prisma.$transaction(async (tx) => {
      let orgMember = await tx.orgMember.findUnique({
        where: { email },
        select: { memberId: true },
      });

      if (!orgMember) {
        orgMember = await tx.orgMember.create({
          data: {
            orgId: params.workspace.orgId,
            email,
            role: OrgRole.COMMUNITY_MEMBER as any,
          },
          select: { memberId: true },
        });
      }

      const hasCompletedOnboarding = await this.userService.hasCompletedOnboarding(email);

      let workspaceUser = await tx.user.findUnique({
        where: {
          email_workspaceId: {
            email,
            workspaceId: params.workspace.id,
          },
        },
      });

      const isNewUser = !hasCompletedOnboarding;
      if (workspaceUser) {
        workspaceUser = await tx.user.update({
          where: { id: workspaceUser.id },
          data: {
            providerUserId: params.userData.providerUserId,
            name: params.userData.name || workspaceUser.name,
            picture: params.userData.picture ?? workspaceUser.picture,
            authProvider: normalizedAuthProvider,
            status: UserStatus.ACTIVE,
            leftAt: null,
          },
        });
      } else {
        workspaceUser = await tx.user.create({
          data: {
            providerUserId: params.userData.providerUserId,
            email,
            name: params.userData.name,
            picture: params.userData.picture,
            authProvider: normalizedAuthProvider,
            workspace: { connect: { id: params.workspace.id } },
            role: COMMUNITY_MEMBER_WORKSPACE_ROLE,
            orgMember: { connect: { memberId: orgMember.memberId } },
          },
        });
      }

      return { workspaceUser, isNewUser };
    });

    if (landingChannelId) {
      try {
        await repositories.channelParticipants.addParticipant(
          landingChannelId,
          result.workspaceUser.id,
          ChannelRole.MEMBER,
        );
      } catch (error) {
        logger.error('[CommunityWorkspaceService] Failed to add user to landing channel', {
          workspaceId: params.workspace.id,
          userId: result.workspaceUser.id,
          landingChannelId,
          error,
        });
      }
    }

    await grantPermissionsForRole(
      result.workspaceUser.id,
      result.workspaceUser.email,
      COMMUNITY_MEMBER_WORKSPACE_ROLE,
      params.workspace.id
    );

    // Join the community workspace's general channel (idempotent)
    try {
      await joinUserToGeneralChannel(
        this.prisma,
        params.workspace.id,
        result.workspaceUser.id,
        ChannelRole.MEMBER
      );
    } catch (error) {
      logger.error('[CommunityWorkspaceService] Failed to join user to general channel', {
        workspaceId: params.workspace.id,
        userId: result.workspaceUser.id,
        error,
      });
    }

    try {
      await aiProvisioningService.enqueueUserSync(result.workspaceUser.orgMemberId);
    } catch (error) {
      logger.error('[CommunityWorkspaceService] Failed to enqueue AI provisioning job', {
        workspaceId: params.workspace.id,
        userId: result.workspaceUser.id,
        error,
      });
    }

    logger.info('[CommunityWorkspaceService] Joined open community workspace', {
      email,
      workspaceId: params.workspace.id,
      isNewUser: result.isNewUser,
    });

    return {
      workspaceUser: result.workspaceUser,
      isNewUser: result.isNewUser,
      landingChannelId,
      status: CommunityJoinResultStatus.JOINED,
    };
  }

  private async joinRequestCommunityWorkspace(params: {
    workspace: CommunityWorkspace;
    channelId?: string;
    userData: CommunityJoinUserData;
  }): Promise<CommunityJoinResult> {
    const email = params.userData.email;
    const existingUser = await this.prisma.user.findUnique({
      where: {
        email_workspaceId: {
          email,
          workspaceId: params.workspace.id,
        },
      },
      select: { id: true, leftAt: true },
    });

    if (existingUser && !existingUser.leftAt) {
      return this.joinOpenCommunityWorkspace(params);
    }

    const latestRequest = await this.prisma.workspaceJoinRequest.findFirst({
      where: {
        workspaceId: params.workspace.id,
        email,
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (latestRequest?.status === WorkspaceJoinRequestStatus.APPROVED) {
      return this.joinOpenCommunityWorkspace(params);
    }

    if (latestRequest?.status === WorkspaceJoinRequestStatus.PENDING) {
      logger.info('[CommunityWorkspaceService] Reused pending community workspace approval', {
        email,
        workspaceId: params.workspace.id,
        requestId: latestRequest.id,
      });

      return {
        status: CommunityJoinResultStatus.REQUEST_PENDING,
        landingChannelId: null,
        joinRequest: {
          id: latestRequest.id,
          status: WorkspaceJoinRequestStatus.PENDING,
          isExisting: true,
        },
      };
    }

    if (latestRequest?.status === WorkspaceJoinRequestStatus.REJECTED) {
      return {
        status: CommunityJoinResultStatus.REQUEST_REJECTED,
        landingChannelId: null,
        joinRequest: {
          id: latestRequest.id,
          status: WorkspaceJoinRequestStatus.REJECTED,
          isExisting: true,
        },
      };
    }

    const joinRequest = await this.prisma.workspaceJoinRequest.create({
      data: {
        workspaceId: params.workspace.id,
        email,
        status: WorkspaceJoinRequestStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    logger.info('[CommunityWorkspaceService] Created/requested community workspace approval', {
      email,
      workspaceId: params.workspace.id,
      requestId: joinRequest.id,
    });

    return {
      status: CommunityJoinResultStatus.REQUEST_PENDING,
      landingChannelId: null,
      joinRequest: {
        id: joinRequest.id,
        status: WorkspaceJoinRequestStatus.PENDING,
        isExisting: false,
      },
    };
  }

  async listOrgJoinRequests(params: {
    orgId: string;
    reviewerUserId: string;
    status?: string;
  }): Promise<CommunityJoinRequestListItem[]> {
    await this.assertOrgRequestReviewer(params.orgId, params.reviewerUserId);

    const status = params.status?.trim().toUpperCase();
    if (status && !Object.values(WorkspaceJoinRequestStatus).includes(status as any)) {
      this.raise('Invalid join request status', 400);
    }

    const workspaces = await this.prisma.workspace.findMany({
      where: {
        orgId: params.orgId,
        status: Status.ACTIVE,
        OR: [
          { workspaceType: WorkspaceType.COMMUNITY },
          { workspaceType: WorkspaceType.ENTERPRISE },
          { workspaceType: null },
        ],
      },
      select: {
        id: true,
        name: true,
        workspaceType: true,
      },
    });

    if (workspaces.length === 0) {
      return [];
    }

    const workspaceById = new Map(workspaces.map(workspace => [workspace.id, workspace]));
    const requests = await this.prisma.workspaceJoinRequest.findMany({
      where: {
        workspaceId: { in: workspaces.map(workspace => workspace.id) },
        ...(status ? { status } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return requests.map(request => {
      const workspace = workspaceById.get(request.workspaceId);
      return {
        ...request,
        ...(workspace ? { workspaceName: workspace.name, workspaceType: workspace.workspaceType } : {}),
      };
    });
  }

  async reviewJoinRequest(params: {
    workspaceId: string;
    requestId: string;
    reviewerUserId: string;
    action: WorkspaceJoinRequestActionType;
    reviewNote?: string;
  }): Promise<CommunityJoinRequestListItem> {
    await this.assertOrgReviewer(params.workspaceId, params.reviewerUserId);

    const request = await this.prisma.workspaceJoinRequest.findFirst({
      where: { id: params.requestId, workspaceId: params.workspaceId },
    });

    if (!request) {
      this.raise('Join request not found', 404);
    }

    if (request.status !== WorkspaceJoinRequestStatus.PENDING) {
      this.raise('Only pending join requests can be reviewed', 409);
    }

    const status =
      params.action === WorkspaceJoinRequestAction.APPROVE
        ? WorkspaceJoinRequestStatus.APPROVED
        : WorkspaceJoinRequestStatus.REJECTED;

    const reviewed = await this.prisma.workspaceJoinRequest.update({
      where: { id: params.requestId },
      data: {
        status,
        reviewedByUserId: params.reviewerUserId,
        reviewedAt: new Date(),
        reviewNote: params.reviewNote?.trim() || null,
        updatedAt: new Date(),
      },
    });

    logger.info('[CommunityWorkspaceService] Reviewed community workspace join request', {
      requestId: params.requestId,
      workspaceId: params.workspaceId,
      status,
      reviewerUserId: params.reviewerUserId,
    });

    if (status === WorkspaceJoinRequestStatus.APPROVED) {
      await this.grantEnterpriseAccessForApprovedRequest(reviewed);
      await this.sendJoinRequestApprovalEmail(reviewed);
    }

    return reviewed;
  }

  private async assertOrgReviewer(workspaceId: string, reviewerUserId: string): Promise<void> {
    const [workspace, reviewer] = await Promise.all([
      this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { orgId: true, workspaceType: true },
      }),
      this.prisma.user.findUnique({
        where: { id: reviewerUserId },
        select: { email: true, leftAt: true },
      }),
    ]);

    if (
      !workspace ||
      (
        workspace.workspaceType !== WorkspaceType.COMMUNITY &&
        workspace.workspaceType !== WorkspaceType.ENTERPRISE &&
        workspace.workspaceType !== null
      )
    ) {
      this.raise('Workspace not found', 404);
    }

    if (!reviewer || reviewer.leftAt) {
      this.raise('You do not have permission to review join requests for this workspace', 403);
    }

    const orgMember = await this.prisma.orgMember.findUnique({
      where: { email: reviewer.email },
      select: { orgId: true, role: true },
    });

    if (
      !orgMember ||
      orgMember.orgId !== workspace.orgId ||
      (orgMember.role !== OrgRole.ADMIN && orgMember.role !== OrgRole.OWNER)
    ) {
      this.raise('Only organization owners and admins can review join requests', 403);
    }
  }

  private async assertOrgRequestReviewer(orgId: string, reviewerUserId: string): Promise<void> {
    const reviewer = await this.prisma.user.findUnique({
      where: { id: reviewerUserId },
      select: { email: true, leftAt: true },
    });

    if (!reviewer || reviewer.leftAt) {
      this.raise('You do not have permission to review join requests for this organization', 403);
    }

    const orgMember = await this.prisma.orgMember.findUnique({
      where: { email: reviewer.email },
      select: { orgId: true, role: true },
    });

    if (
      !orgMember ||
      orgMember.orgId !== orgId ||
      (orgMember.role !== OrgRole.ADMIN && orgMember.role !== OrgRole.OWNER)
    ) {
      this.raise('Only organization owners and admins can review join requests', 403);
    }
  }

  private async grantEnterpriseAccessForApprovedRequest(
    request: CommunityJoinRequestListItem
  ): Promise<void> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: request.workspaceId },
      select: { orgId: true, workspaceType: true },
    });

    if (
      !workspace ||
      workspace.workspaceType === WorkspaceType.COMMUNITY
    ) {
      return;
    }

    // Provisions the approved requester's membership, not the reviewer's.
    const existingOrgMember = await withWorkspaceScope(async () => {
      const current = await this.prisma.orgMember.findUnique({
        where: { email: request.email },
        select: { memberId: true, role: true },
      });

      await this.prisma.orgMember.upsert({
        where: { email: request.email },
        create: {
          orgId: workspace.orgId,
          email: request.email,
          role: OrgRole.MEMBER,
          leftAt: null,
        },
        update: {
          orgId: workspace.orgId,
          role: OrgRole.MEMBER,
          leftAt: null,
        },
      });

      return current;
    });

    if (existingOrgMember?.role === OrgRole.COMMUNITY_MEMBER) {
      await aiProvisioningService.upgradeCommunityToEnterpriseBudget(existingOrgMember.memberId);
    }
  }

  private async sendJoinRequestApprovalEmail(request: CommunityJoinRequestListItem): Promise<void> {
    try {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: request.workspaceId },
        select: { name: true },
      });

      const workspaceName = workspace?.name || 'your';
      const joinLink = this.buildCommunityJoinLink(request.workspaceId);
      const templateValues = {
        workspaceName,
        workspaceId: request.workspaceId,
        joinLink,
        email: request.email,
      };
      const text = this.renderEmailTemplate(
        config.communityJoinApprovedEmail.message,
        templateValues
      );

      const result = await emailService.sendEmail({
        to: request.email,
        subject: `Your request to join ${workspaceName} Community is approved`,
        text,
        html: communityJoinApprovedEmailHtml({
          workspaceName,
          joinLink,
          message: text,
        }),
      });

      if (!result.success) {
        logger.warn('[CommunityWorkspaceService] Failed to send join request approval email', {
          requestId: request.id,
          workspaceId: request.workspaceId,
          email: request.email,
          error: result.error,
        });
        return;
      }

      logger.info('[CommunityWorkspaceService] Sent join request approval email', {
        requestId: request.id,
        workspaceId: request.workspaceId,
        email: request.email,
        messageId: result.messageId,
      });
    } catch (error) {
      logger.error('[CommunityWorkspaceService] Failed to send join request approval email', {
        requestId: request.id,
        workspaceId: request.workspaceId,
        email: request.email,
        error,
      });
    }
  }

  private buildCommunityJoinLink(workspaceId: string): string {
    const frontendUrl = (config.frontendUrl || config.slackFrontendUrl || '').replace(/\/+$/, '');
    const baseUrl = frontendUrl || 'http://localhost:5173';
    return `${baseUrl}/community/join?workspaceId=${encodeURIComponent(workspaceId)}`;
  }

  private renderEmailTemplate(
    template: string,
    values: Record<'workspaceName' | 'workspaceId' | 'joinLink' | 'email', string>
  ): string {
    return template
      .replace(/\\n/g, '\n')
      .replace(TEMPLATE_TOKEN_PATTERN, (_match, token: keyof typeof values) => values[token]);
  }

  private raise(message: string, statusCode: number): never {
    const error = new Error(message) as Error & { statusCode?: number };
    error.statusCode = statusCode;
    throw error;
  }
}

export const communityWorkspaceService = new CommunityWorkspaceService();
