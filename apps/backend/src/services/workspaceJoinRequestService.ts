import {
  OrgRole,
  Status,
  WorkspaceJoinRequestAction,
  type WorkspaceJoinRequestAction as WorkspaceJoinRequestActionType,
  WorkspaceJoinRequestStatus,
  type WorkspaceJoinRequestStatus as WorkspaceJoinRequestStatusType,
  WorkspaceType,
} from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { emailService } from '@/services/email/factory';
import { workspaceJoinApprovedEmailHtml } from '@/services/email/templates/workspace-join-approved';
import { aiProvisioningService } from '@/services/aiProvisioningService';
import { organizationDomainService } from '@/services/organizationDomainService';
import { withWorkspaceScope } from '@/database/tenant/context';

export interface WorkspaceJoinRequestResult {
  id: string;
  status: WorkspaceJoinRequestStatusType;
  isExisting: boolean;
}

export interface WorkspaceJoinRequestListItem {
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

const ENTERPRISE_WORKSPACE_TYPE_FILTER = [
  { workspaceType: WorkspaceType.ENTERPRISE },
  { workspaceType: null },
];

export class WorkspaceJoinRequestService {
  prisma = DatabaseClient.getInstance();

  async requestJoin(params: { workspaceId: string; email: string }): Promise<WorkspaceJoinRequestResult> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: params.workspaceId },
      select: { id: true, orgId: true, status: true, workspaceType: true },
    });

    if (!workspace || workspace.status !== Status.ACTIVE) {
      this.raise('Workspace not found', 404);
    }

    if (workspace.workspaceType !== WorkspaceType.ENTERPRISE && workspace.workspaceType !== null) {
      this.raise('Workspace is not an enterprise workspace', 400);
    }

    const email = params.email;
    if (!organizationDomainService.shouldLookupDomain(email)) {
      this.raise('Public email domains cannot join enterprise workspaces. Please use your work email.', 403);
    }

    const existingOrg = await organizationDomainService.findExistingOrgByEmailDomain(email);
    if (!existingOrg || existingOrg.orgId !== workspace.orgId) {
      this.raise('Email domain is not allowed to request access to this workspace', 403);
    }

    const existingUser = await this.prisma.user.findUnique({
      where: {
        email_workspaceId: {
          email,
          workspaceId: workspace.id,
        },
      },
      select: { id: true, leftAt: true },
    });

    if (existingUser && !existingUser.leftAt) {
      this.raise('You already have access to this workspace', 409);
    }

    const latestRequest = await this.prisma.workspaceJoinRequest.findFirst({
      where: {
        workspaceId: workspace.id,
        email,
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (latestRequest) {
      return {
        id: latestRequest.id,
        status: latestRequest.status as WorkspaceJoinRequestStatusType,
        isExisting: true,
      };
    }

    const joinRequest = await this.prisma.workspaceJoinRequest.create({
      data: {
        workspaceId: workspace.id,
        email,
        status: WorkspaceJoinRequestStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    logger.info('[WorkspaceJoinRequestService] Created workspace join request', {
      email,
      workspaceId: workspace.id,
      orgId: existingOrg.orgId,
      requestId: joinRequest.id,
    });

    return {
      id: joinRequest.id,
      status: WorkspaceJoinRequestStatus.PENDING,
      isExisting: false,
    };
  }

  async listOrgJoinRequests(params: {
    orgId: string;
    reviewerUserId: string;
    status?: string;
  }): Promise<WorkspaceJoinRequestListItem[]> {
    await this.assertOrgRequestReviewer(params.orgId, params.reviewerUserId);

    const status = params.status?.trim().toUpperCase();
    if (status && !Object.values(WorkspaceJoinRequestStatus).includes(status as WorkspaceJoinRequestStatusType)) {
      this.raise('Invalid join request status', 400);
    }

    const workspaces = await this.prisma.workspace.findMany({
      where: {
        orgId: params.orgId,
        status: Status.ACTIVE,
        OR: ENTERPRISE_WORKSPACE_TYPE_FILTER,
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
  }): Promise<WorkspaceJoinRequestListItem> {
    const workspace = await this.assertOrgReviewer(params.workspaceId, params.reviewerUserId);

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

    logger.info('[WorkspaceJoinRequestService] Reviewed workspace join request', {
      requestId: params.requestId,
      workspaceId: params.workspaceId,
      status,
      reviewerUserId: params.reviewerUserId,
    });

    if (status === WorkspaceJoinRequestStatus.APPROVED) {
      await this.grantAccessForApprovedRequest(reviewed, workspace.orgId);
      await this.sendJoinRequestApprovalEmail(reviewed);
    }

    return reviewed;
  }

  private async assertOrgReviewer(
    workspaceId: string,
    reviewerUserId: string,
  ): Promise<{ orgId: string }> {
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
      (workspace.workspaceType !== WorkspaceType.ENTERPRISE && workspace.workspaceType !== null)
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

    return { orgId: workspace.orgId };
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

  private async grantAccessForApprovedRequest(
    request: WorkspaceJoinRequestListItem,
    orgId: string,
  ): Promise<void> {
    // Provisions the approved requester's membership, not the reviewer's.
    const existingOrgMember = await withWorkspaceScope(async () => {
      const current = await this.prisma.orgMember.findUnique({
        where: { email: request.email },
        select: { memberId: true, role: true },
      });

      await this.prisma.orgMember.upsert({
        where: { email: request.email },
        create: {
          orgId,
          email: request.email,
          role: OrgRole.MEMBER,
          leftAt: null,
        },
        update: {
          orgId,
          role: OrgRole.MEMBER,
          leftAt: null,
        },
      });

      return current;
    });

    if (existingOrgMember?.role === OrgRole.COMMUNITY_MEMBER) {
      await aiProvisioningService.resyncUserBudget(existingOrgMember.memberId);
    }
  }

  private async sendJoinRequestApprovalEmail(request: WorkspaceJoinRequestListItem): Promise<void> {
    try {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: request.workspaceId },
        select: { name: true },
      });

      const workspaceName = workspace?.name || 'your workspace';
      const loginLink = this.buildLoginLink();

      const result = await emailService.sendEmail({
        to: request.email,
        subject: `Your request to join ${workspaceName} is approved`,
        text: `Your request to join ${workspaceName} is approved.\n\nYou can log in now: ${loginLink}`,
        html: workspaceJoinApprovedEmailHtml({ workspaceName, loginLink }),
      });

      if (!result.success) {
        logger.warn('[WorkspaceJoinRequestService] Failed to send join request approval email', {
          requestId: request.id,
          workspaceId: request.workspaceId,
          email: request.email,
          error: result.error,
        });
        return;
      }

      logger.info('[WorkspaceJoinRequestService] Sent join request approval email', {
        requestId: request.id,
        workspaceId: request.workspaceId,
        email: request.email,
        messageId: result.messageId,
      });
    } catch (error) {
      logger.error('[WorkspaceJoinRequestService] Failed to send join request approval email', {
        requestId: request.id,
        workspaceId: request.workspaceId,
        email: request.email,
        error,
      });
    }
  }

  private buildLoginLink(): string {
    const frontendUrl = (config.frontendUrl || config.slackFrontendUrl || '').replace(/\/+$/, '');
    const baseUrl = frontendUrl || 'http://localhost:5173';
    return `${baseUrl}/auth`;
  }

  private raise(message: string, statusCode: number): never {
    const error = new Error(message) as Error & { statusCode?: number };
    error.statusCode = statusCode;
    throw error;
  }
}

export const workspaceJoinRequestService = new WorkspaceJoinRequestService();
