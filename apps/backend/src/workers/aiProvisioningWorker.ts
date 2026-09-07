import Bull from 'bull';
import {
  AIProvisioningStatus as AIProvisioningStatusValue,
  AIProvisioningSubjectType,
  OrgLLMServiceAccountCredentialStatus,
  OrgLLMServiceAccountProvider,
  OrgLLMServiceAccountPurpose,
  WorkspaceType,
} from '@xyne/shared';
import { config } from '@/config/env';
import { DatabaseClient } from '@/database/client';
import {
  AI_PROVISIONING_JOB_NAME,
  AIProvisioningJobData,
  aiProvisioningQueue,
} from '@/queues/aiProvisioningQueue';
import {
  ClawSpacesSyncError,
  clawSpacesSyncClient,
  ClawSyncOrgPayload,
  ClawSyncUserPayload,
  ClawSyncWorkspacePayload,
} from '@/services/clawSpacesSyncClient';
import {
  LiteLLMProvisioningError,
  litellmProvisioningClient,
} from '@/services/litellmProvisioningClient';
import { decrypt, encrypt } from '@/services/encryptionService';
import { logger } from '@/utils/logger';

interface OrgLiteLLMServiceAccountCredentials {
  source: 'xyne-spaces';
  litellmTeamId: string;
  litellmUserId?: string;
  key?: string;
  tokenId?: string;
  keyName?: string;
  keyAlias?: string;
  providerUrl: string;
  defaultModel?: string | null;
  defaultModels?: string[];
  serviceAccountName?: string;
  serviceAccountAlias?: string;
  expires?: string;
  teamAlias?: string;
  purpose?: OrgLLMServiceAccountPurpose;
  provisionedAt: string;
}

const ORG_SERVICE_ACCOUNT_PURPOSES = [
  OrgLLMServiceAccountPurpose.DEFAULT,
  OrgLLMServiceAccountPurpose.ASK_AI,
  OrgLLMServiceAccountPurpose.CALL_TRANSCRIPT,
  OrgLLMServiceAccountPurpose.ACTIVITY_CLASSIFICATION,
  OrgLLMServiceAccountPurpose.CLAW_ORG_KEY,
] as const;

type AIProvisioningUserPayload = ClawSyncUserPayload & {
  workspaceType: string | null;
};

class AIProvisioningWorker {
  private prisma = DatabaseClient.getInstance();
  private started = false;

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    await aiProvisioningQueue.initialize();
    const queue = aiProvisioningQueue.getQueue();

    queue.process(AI_PROVISIONING_JOB_NAME, 1, async (job: Bull.Job<AIProvisioningJobData>) => {
      await this.processJob(job);
    });

    this.started = true;
    logger.info('[AI-PROVISIONING-WORKER] Started with concurrency 1');
  }

  async shutdown(): Promise<void> {
    if (!this.started) {
      return;
    }

    await aiProvisioningQueue.close();
    this.started = false;
    logger.info('[AI-PROVISIONING-WORKER] Shutdown complete');
  }

  private async processJob(job: Bull.Job<AIProvisioningJobData>): Promise<void> {
    const status = await this.prisma.aiProvisioningStatus.findUnique({
      where: { id: job.data.provisioningStatusId },
    });

    if (!status) {
      logger.warn(
        `[AI-PROVISIONING-WORKER] Status row not found for job ${job.id}: ${job.data.provisioningStatusId}`,
      );
      return;
    }

    if (status.status === AIProvisioningStatusValue.SUCCESS) {
      return;
    }

    const now = new Date();
    const attemptNumber = status.attempts + 1;
    await this.prisma.aiProvisioningStatus.update({
      where: { id: status.id },
      data: {
        status: AIProvisioningStatusValue.RUNNING,
        attempts: attemptNumber,
        lastAttemptedAt: now,
        updatedAt: now,
      },
    });

    try {
      await this.provisionSubject(status.subjectType, status.subjectId);

      await this.prisma.aiProvisioningStatus.update({
        where: { id: status.id },
        data: {
          status: AIProvisioningStatusValue.SUCCESS,
          lastError: null,
          updatedAt: new Date(),
        },
      });

      logger.info('[AI-PROVISIONING-WORKER] Provisioning succeeded', {
        subjectType: status.subjectType,
        subjectId: status.subjectId,
        provisioningStatusId: status.id,
      });
    } catch (error) {
      const retryable = this.isRetryable(error);
      const message = error instanceof Error ? error.message : String(error);
      const shouldRetry = retryable && attemptNumber < this.maxAttempts(job);

      await this.prisma.aiProvisioningStatus.update({
        where: { id: status.id },
        data: {
          status: shouldRetry
            ? AIProvisioningStatusValue.PENDING
            : AIProvisioningStatusValue.FAILED,
          lastError: message,
          updatedAt: new Date(),
        },
      });

      logger.error('[AI-PROVISIONING-WORKER] Provisioning failed', {
        subjectType: status.subjectType,
        subjectId: status.subjectId,
        provisioningStatusId: status.id,
        retryable,
        shouldRetry,
        attemptNumber,
        error: message,
      });

      if (shouldRetry) {
        throw error;
      }
    }
  }

  private async provisionSubject(subjectType: string, subjectId: string): Promise<void> {
    switch (subjectType) {
      case AIProvisioningSubjectType.ORG:
        await this.provisionOrg(subjectId);
        return;
      case AIProvisioningSubjectType.WORKSPACE:
        await this.provisionWorkspace(subjectId);
        return;
      case AIProvisioningSubjectType.USER:
        await this.provisionUser(subjectId);
        return;
      default:
        throw new ClawSpacesSyncError(`Unknown AI provisioning subject type: ${subjectType}`, {
          retryable: false,
        });
    }
  }

  private async provisionOrg(orgId: string): Promise<void> {
    const orgPayload = await this.buildOrgPayload(orgId);
    await clawSpacesSyncClient.syncOrg(orgPayload);
    const teamId = await this.ensureLiteLLMTeamForOrg(orgPayload);
    await this.ensureOrgLiteLLMServiceAccountCredentials(orgPayload, teamId);
  }

  private async provisionWorkspace(workspaceId: string): Promise<void> {
    const workspacePayload = await this.buildWorkspacePayload(workspaceId);
    const orgPayload = await this.buildOrgPayload(workspacePayload.spacesOrgId);

    await clawSpacesSyncClient.syncOrg(orgPayload);
    await clawSpacesSyncClient.syncWorkspace(workspacePayload);
    const teamId = await this.ensureLiteLLMTeamForOrg(orgPayload);
    await this.ensureOrgLiteLLMServiceAccountCredentials(orgPayload, teamId);
  }

  private async provisionUser(orgMemberId: string): Promise<void> {
    const sourceUser = await this.prisma.user.findFirst({
      where: { orgMemberId, leftAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!sourceUser) {
      throw new ClawSpacesSyncError(
        `No active workspace user found for AI provisioning org member: ${orgMemberId}`,
        { retryable: false },
      );
    }

    const userPayload = await this.buildUserPayload(sourceUser.id);
    const { workspaceType, ...clawUserPayload } = userPayload;
    const orgPayload = await this.buildOrgPayload(userPayload.spacesOrgId);
    const workspacePayload = await this.buildWorkspacePayload(userPayload.spacesWorkspaceId);
    const userBudget = this.getUserLiteLLMBudget(workspaceType);

    const isFirstOrgMember = await this.isFirstOrgMember(
      userPayload.spacesOrgId,
      userPayload.spacesOrgMemberId,
    );
    if (isFirstOrgMember) {
      clawUserPayload.grantClawAdmin = true;
    }

    await clawSpacesSyncClient.syncOrg(orgPayload);
    await clawSpacesSyncClient.syncWorkspace(workspacePayload);
    await clawSpacesSyncClient.syncUser(clawUserPayload);

    // LiteLLM KEY creation stays behind the env flag: orgs without managed
    if (!config.aiProvisioning.enableUserProvisioning) {
      logger.info('[AI-PROVISIONING-WORKER] User key provisioning disabled — skipping LiteLLM key creation', {
        subjectId: orgMemberId,
      });
      return;
    }

    const teamId = await this.ensureLiteLLMTeamForOrg(orgPayload);
    await this.ensureOrgLiteLLMServiceAccountCredentials(orgPayload, teamId);
    // A Spaces user row is a workspace membership. LiteLLM keys must instead
    // belong to the person within the organization, so all key provisioning
    // uses the stable org-member ID.
    const canonicalProvisioningUserId = userPayload.spacesOrgMemberId;
    const { litellmUserId } = await litellmProvisioningClient.createUser({
      orgId: userPayload.spacesOrgId,
      userId: canonicalProvisioningUserId,
      email: userPayload.email,
      name: userPayload.name,
      teamId,
      budget: userBudget,
      metadata: {
        spaces_org_member_id: userPayload.spacesOrgMemberId,
        spaces_workspace_id: userPayload.spacesWorkspaceId,
        spaces_user_id: userPayload.spacesUserId,
      },
    });
    const key = await litellmProvisioningClient.generateKey({
      orgId: userPayload.spacesOrgId,
      userId: canonicalProvisioningUserId,
      email: userPayload.email,
      litellmUserId,
      teamId,
      budget: userBudget,
      metadata: {
        spaces_org_member_id: userPayload.spacesOrgMemberId,
        spaces_workspace_id: userPayload.spacesWorkspaceId,
        spaces_user_id: userPayload.spacesUserId,
      },
    });

    await litellmProvisioningClient.storeUserKey({
      userId: canonicalProvisioningUserId,
      orgId: userPayload.spacesOrgId,
      spacesOrgId: userPayload.spacesOrgId,
      spacesWorkspaceId: userPayload.spacesWorkspaceId,
      spacesOrgMemberId: userPayload.spacesOrgMemberId,
      litellmUserId,
      teamId,
      key: key.key,
      tokenId: key.tokenId,
      keyName: key.keyName,
      keyAlias: key.keyAlias,
      expires: key.expires,
    });
  }

  private async ensureLiteLLMTeamForOrg(orgPayload: ClawSyncOrgPayload): Promise<string> {
    const existing = await this.getOrgLiteLLMTeamId(orgPayload.spacesOrgId);

    if (existing) {
      await litellmProvisioningClient.storeTeam({
        orgId: orgPayload.spacesOrgId,
        teamId: existing,
        teamAlias: orgPayload.name,
        status: orgPayload.status,
      });
      return existing;
    }

    const team = await litellmProvisioningClient.createTeam({
      orgId: orgPayload.spacesOrgId,
      teamAlias: orgPayload.name,
    });

    await litellmProvisioningClient.storeTeam({
      orgId: orgPayload.spacesOrgId,
      teamId: team.teamId,
      teamAlias: team.teamAlias ?? orgPayload.name,
      status: orgPayload.status,
    });
    return team.teamId;
  }

  private async getOrgLiteLLMTeamId(orgId: string): Promise<string | null> {
    const credential = await this.prisma.orgLLMServiceAccountCredential.findUnique({
      where: {
        orgId_provider_purpose: {
          orgId,
          provider: OrgLLMServiceAccountProvider.LITELLM,
          purpose: OrgLLMServiceAccountPurpose.DEFAULT,
        },
      },
      select: {
        credentials: true,
        status: true,
      },
    });

    if (!credential || credential.status === OrgLLMServiceAccountCredentialStatus.REVOKED) {
      return null;
    }

    try {
      const parsed = JSON.parse(decrypt(credential.credentials)) as Partial<OrgLiteLLMServiceAccountCredentials>;
      return typeof parsed.litellmTeamId === 'string' && parsed.litellmTeamId.trim()
        ? parsed.litellmTeamId
        : null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new LiteLLMProvisioningError(
        `Failed to read org LiteLLM service account credentials for org ${orgId}: ${message}`,
        { retryable: false },
      );
    }
  }

  private async ensureOrgLiteLLMServiceAccountCredentials(
    orgPayload: ClawSyncOrgPayload,
    litellmTeamId: string,
  ): Promise<void> {
    for (const purpose of ORG_SERVICE_ACCOUNT_PURPOSES) {
      await this.ensureOrgLiteLLMServiceAccountCredential(orgPayload, litellmTeamId, purpose);
    }
  }

  private async ensureOrgLiteLLMServiceAccountCredential(
    orgPayload: ClawSyncOrgPayload,
    litellmTeamId: string,
    purpose: OrgLLMServiceAccountPurpose,
  ): Promise<void> {
    const existing = await this.prisma.orgLLMServiceAccountCredential.findUnique({
      where: {
        orgId_provider_purpose: {
          orgId: orgPayload.spacesOrgId,
          provider: OrgLLMServiceAccountProvider.LITELLM,
          purpose,
        },
      },
      select: {
        status: true,
      },
    });

    if (existing?.status === OrgLLMServiceAccountCredentialStatus.ACTIVE) {
      return;
    }

    const serviceAccount = this.buildOrgServiceAccountIdentity(orgPayload, purpose);
    await this.storeOrgLiteLLMServiceAccountCredential({
      orgPayload,
      litellmTeamId,
      purpose,
      status: OrgLLMServiceAccountCredentialStatus.PENDING,
      litellmUserId: serviceAccount.litellmUserId,
      keyAlias: serviceAccount.keyAlias,
      serviceAccountName: serviceAccount.name,
      serviceAccountAlias: serviceAccount.alias,
    });

    const { litellmUserId } = await litellmProvisioningClient.createUser({
      orgId: orgPayload.spacesOrgId,
      userId: serviceAccount.externalUserId,
      email: serviceAccount.email,
      name: serviceAccount.name,
      teamId: litellmTeamId,
      litellmUserId: serviceAccount.litellmUserId,
      metadata: {
        purpose,
        source: 'xyne-spaces',
        service_account: true,
      },
    });
    const key = await litellmProvisioningClient.generateKey({
      orgId: orgPayload.spacesOrgId,
      userId: serviceAccount.externalUserId,
      email: serviceAccount.email,
      litellmUserId,
      teamId: litellmTeamId,
      keyAlias: serviceAccount.keyAlias,
      metadata: {
        purpose,
        source: 'xyne-spaces',
        service_account: true,
      },
    });

    await this.storeOrgLiteLLMServiceAccountCredential({
      orgPayload,
      litellmTeamId,
      purpose,
      status: OrgLLMServiceAccountCredentialStatus.ACTIVE,
      litellmUserId,
      key: key.key,
      tokenId: key.tokenId,
      keyName: key.keyName,
      keyAlias: key.keyAlias,
      serviceAccountName: serviceAccount.name,
      serviceAccountAlias: serviceAccount.alias,
      expires: key.expires,
    });

    if (purpose === OrgLLMServiceAccountPurpose.CLAW_ORG_KEY) {
      await litellmProvisioningClient.storeOrgKey({
        orgId: orgPayload.spacesOrgId,
        key: key.key,
        teamId: litellmTeamId,
        tokenId: key.tokenId,
        keyName: key.keyName,
        keyAlias: key.keyAlias,
        expires: key.expires,
      });
    }
  }

  private buildOrgServiceAccountIdentity(
    orgPayload: ClawSyncOrgPayload,
    purpose: OrgLLMServiceAccountPurpose,
  ): {
    externalUserId: string;
    litellmUserId: string;
    email: string;
    name: string;
    alias: string;
    keyAlias: string;
  } {
    const orgName = orgPayload.name || orgPayload.spacesOrgId;
    const serviceAccountName = `${purpose}-${orgName}-service-account`;
    const orgSlug = slugify(orgName);
    const purposeSlug = purpose.toLowerCase().replace(/_/g, '-');
    const externalUserId = `${orgPayload.spacesOrgId}-${purpose}`;

    return {
      externalUserId,
      litellmUserId: `claw-service-account-${orgPayload.spacesOrgId}-${purpose}`,
      email: `${purposeSlug}@${orgSlug}-service-account`,
      name: serviceAccountName,
      alias: serviceAccountName,
      keyAlias: serviceAccountName,
    };
  }

  private getUserLiteLLMBudget(workspaceType: string | null | undefined): number | undefined {
    const budget = workspaceType === WorkspaceType.COMMUNITY
      ? config.aiProvisioning.communityWorkspaceUserBudget
      : config.aiProvisioning.enterpriseWorkspaceUserBudget;
    return budget ?? undefined;
  }

  private async storeOrgLiteLLMServiceAccountCredential(params: {
    orgPayload: ClawSyncOrgPayload;
    litellmTeamId: string;
    purpose: OrgLLMServiceAccountPurpose;
    status: OrgLLMServiceAccountCredentialStatus;
    litellmUserId?: string;
    key?: string;
    tokenId?: string;
    keyName?: string;
    keyAlias?: string;
    serviceAccountName?: string;
    serviceAccountAlias?: string;
    expires?: string;
  }): Promise<void> {
    const {
      orgPayload,
      litellmTeamId,
      purpose,
      status,
      litellmUserId,
      key,
      tokenId,
      keyName,
      keyAlias,
      serviceAccountName,
      serviceAccountAlias,
      expires,
    } = params;
    const now = new Date();
    const credentials: OrgLiteLLMServiceAccountCredentials = {
      source: 'xyne-spaces',
      litellmTeamId,
      litellmUserId,
      key,
      tokenId,
      keyName,
      keyAlias,
      providerUrl: config.litellm.baseUrl,
      defaultModel: config.aiProvisioning.orgDefaultModels[0] ?? null,
      defaultModels: config.aiProvisioning.orgDefaultModels,
      serviceAccountName,
      serviceAccountAlias,
      expires,
      teamAlias: orgPayload.name,
      purpose,
      provisionedAt: now.toISOString(),
    };

    await this.storeOrgLiteLLMEncryptedCredentials({
      orgPayload,
      purpose,
      status,
      credentials,
    });
  }

  private async storeOrgLiteLLMEncryptedCredentials(params: {
    orgPayload: ClawSyncOrgPayload;
    purpose: OrgLLMServiceAccountPurpose;
    status: OrgLLMServiceAccountCredentialStatus;
    credentials: OrgLiteLLMServiceAccountCredentials;
  }): Promise<void> {
    const { orgPayload, purpose, status, credentials } = params;
    const now = new Date();
    let encryptedCredentials: string;
    try {
      encryptedCredentials = encrypt(JSON.stringify(credentials));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new LiteLLMProvisioningError(
        `Failed to encrypt org LiteLLM service account credentials for org ${orgPayload.spacesOrgId}: ${message}`,
        { retryable: false },
      );
    }

    await this.prisma.orgLLMServiceAccountCredential.upsert({
      where: {
        orgId_provider_purpose: {
          orgId: orgPayload.spacesOrgId,
          provider: OrgLLMServiceAccountProvider.LITELLM,
          purpose,
        },
      },
      create: {
        orgId: orgPayload.spacesOrgId,
        provider: OrgLLMServiceAccountProvider.LITELLM,
        purpose,
        credentials: encryptedCredentials,
        status,
        lastProvisionedAt:
          status === OrgLLMServiceAccountCredentialStatus.ACTIVE ? now : null,
        createdAt: now,
        updatedAt: now,
      },
      update: {
        credentials: encryptedCredentials,
        status,
        lastProvisionedAt:
          status === OrgLLMServiceAccountCredentialStatus.ACTIVE ? now : null,
        updatedAt: now,
      },
    });
  }

  private async buildOrgPayload(orgId: string): Promise<ClawSyncOrgPayload> {
    const org = await this.prisma.organization.findUnique({
      where: { orgId },
      select: {
        orgId: true,
        name: true,
        description: true,
        createdBy: true,
        status: true,
      },
    });

    if (!org) {
      throw new ClawSpacesSyncError(`Organization not found for AI provisioning: ${orgId}`, {
        retryable: false,
      });
    }

    return {
      spacesOrgId: org.orgId,
      name: org.name,
      description: org.description,
      createdBySpacesUserId: org.createdBy,
      status: org.status,
    };
  }

  private async buildWorkspacePayload(workspaceId: string): Promise<ClawSyncWorkspacePayload> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        orgId: true,
        name: true,
        description: true,
        createdBy: true,
        status: true,
        organization: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!workspace) {
      throw new ClawSpacesSyncError(`Workspace not found for AI provisioning: ${workspaceId}`, {
        retryable: false,
      });
    }

    return {
      spacesWorkspaceId: workspace.id,
      spacesOrgId: workspace.orgId,
      name: workspace.name,
      orgName: workspace.organization.name,
      description: workspace.description,
      createdBySpacesUserId: workspace.createdBy,
      status: workspace.status,
    };
  }

  private async buildUserPayload(userId: string): Promise<AIProvisioningUserPayload> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        orgMemberId: true,
        status: true,
        workspace: {
          select: {
            id: true,
            orgId: true,
            name: true,
            workspaceType: true,
            createdBy: true,
            organization: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new ClawSpacesSyncError(`User not found for AI provisioning: ${userId}`, {
        retryable: false,
      });
    }
    if (!user.orgMemberId.trim()) {
      throw new ClawSpacesSyncError(
        `Cannot provision AI credentials without an org member id for Spaces user ${user.id}`,
        { retryable: false },
      );
    }

    return {
      spacesUserId: user.id,
      spacesWorkspaceId: user.workspace.id,
      spacesOrgId: user.workspace.orgId,
      spacesOrgMemberId: user.orgMemberId,
      email: user.email,
      name: user.name,
      role: user.role,
      workspaceType: user.workspace.workspaceType ?? null,
      workspaceName: user.workspace.name,
      orgName: user.workspace.organization.name,
      createdBySpacesUserId: user.workspace.createdBy,
      status: user.status,
    };
  }

  private async isFirstOrgMember(orgId: string, orgMemberId: string): Promise<boolean> {
    const firstMember = await this.prisma.orgMember.findFirst({
      where: { orgId, leftAt: null },
      orderBy: { joinedAt: 'asc' },
      select: { memberId: true },
    });
    return firstMember?.memberId === orgMemberId;
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof ClawSpacesSyncError) {
      return error.retryable;
    }
    if (error instanceof LiteLLMProvisioningError) {
      return error.retryable;
    }
    return true;
  }

  private maxAttempts(job: Bull.Job<AIProvisioningJobData>): number {
    return job.opts.attempts ?? config.aiProvisioning.queueAttempts;
  }
}

export const aiProvisioningWorker = new AIProvisioningWorker();

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'org';
}
