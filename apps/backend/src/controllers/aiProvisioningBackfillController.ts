import { Request, Response } from 'express';
import {
  AIProvisioningProvider,
  AIProvisioningStatus as AIProvisioningStatusValue,
  AIProvisioningSubjectType,
  OrgLLMServiceAccountCredentialStatus,
  OrgLLMServiceAccountProvider,
  OrgLLMServiceAccountPurpose,
  WorkspaceType,
} from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { decrypt, encrypt } from '@/services/encryptionService';
import {
  clawSpacesSyncClient,
  ClawSyncOrgPayload,
  ClawSyncWorkspacePayload,
  ClawSyncUserPayload,
} from '@/services/clawSpacesSyncClient';
import {
  litellmProvisioningClient,
  LiteLLMProvisioningError,
} from '@/services/litellmProvisioningClient';
import type { ApiResponse } from '@/types/express';

type BackfillMode = 'orgs' | 'workspaces' | 'users';

type BackfillOptions = {
  mode: BackfillMode;
  dryRun: boolean;
  batchSize: number;
};

type SubjectSummary = {
  total: number;
  skipped: number;
  success: number;
  errors: number;
};

type BackfillResult = {
  mode: BackfillMode;
  summary: SubjectSummary;
  errors: Array<{ id: string; error: string }>;
};

const ORG_SERVICE_ACCOUNT_PURPOSES = [
  OrgLLMServiceAccountPurpose.DEFAULT,
  OrgLLMServiceAccountPurpose.ASK_AI,
  OrgLLMServiceAccountPurpose.CALL_TRANSCRIPT,
  OrgLLMServiceAccountPurpose.ACTIVITY_CLASSIFICATION,
] as const;

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

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'org';
}

export class AiProvisioningBackfillController {
  private static prisma = DatabaseClient.getInstance();

  private static buildOptions(body: unknown): BackfillOptions {
    const payload = body as Partial<{ mode: BackfillMode; dryRun: boolean; batchSize: number }>;
    return {
      mode: payload.mode ?? 'orgs',
      dryRun: payload.dryRun === true,
      batchSize: payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 5,
    };
  }

  private static async isProvisioned(
    subjectType: AIProvisioningSubjectType,
    subjectId: string,
  ): Promise<boolean> {
    const row = await this.prisma.aiProvisioningStatus.findUnique({
      where: {
        subjectType_subjectId_provider: {
          subjectType,
          subjectId,
          provider: AIProvisioningProvider.CLAW_LITELLM,
        },
      },
      select: { status: true },
    });
    return row?.status === AIProvisioningStatusValue.SUCCESS;
  }

  private static async markStatus(
    subjectType: AIProvisioningSubjectType,
    subjectId: string,
    status: AIProvisioningStatusValue,
    error?: string,
  ): Promise<void> {
    const now = new Date();
    const existing = await this.prisma.aiProvisioningStatus.findUnique({
      where: {
        subjectType_subjectId_provider: {
          subjectType,
          subjectId,
          provider: AIProvisioningProvider.CLAW_LITELLM,
        },
      },
    });

    if (existing) {
      await this.prisma.aiProvisioningStatus.update({
        where: { id: existing.id },
        data: {
          status,
          lastError: error ?? null,
          lastAttemptedAt: now,
          updatedAt: now,
        },
      });
    } else {
      await this.prisma.aiProvisioningStatus.create({
        data: {
          subjectType,
          subjectId,
          provider: AIProvisioningProvider.CLAW_LITELLM,
          status,
          attempts: 1,
          lastError: error ?? null,
          lastAttemptedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
  }

  // ── ORG PROVISIONING ──────────────────────────────────────────────────

  private static async provisionOrg(orgId: string): Promise<void> {
    const org = await this.prisma.organization.findUnique({
      where: { orgId },
      select: { orgId: true, name: true, description: true, createdBy: true, status: true },
    });
    if (!org) {
      throw new Error(`Organization not found: ${orgId}`);
    }

    const orgPayload: ClawSyncOrgPayload = {
      spacesOrgId: org.orgId,
      name: org.name,
      description: org.description,
      createdBySpacesUserId: org.createdBy,
      status: org.status,
    };

    await clawSpacesSyncClient.syncOrg(orgPayload);

    const teamId = await this.ensureLiteLLMTeam(orgPayload);
    await this.ensureOrgCredentials(orgPayload, teamId);
  }

  private static async ensureLiteLLMTeam(orgPayload: ClawSyncOrgPayload): Promise<string> {
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

  private static async getOrgLiteLLMTeamId(orgId: string): Promise<string | null> {
    const credential = await this.prisma.orgLLMServiceAccountCredential.findUnique({
      where: {
        orgId_provider_purpose: {
          orgId,
          provider: OrgLLMServiceAccountProvider.LITELLM,
          purpose: OrgLLMServiceAccountPurpose.DEFAULT,
        },
      },
      select: { credentials: true, status: true },
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

  private static async ensureOrgCredentials(
    orgPayload: ClawSyncOrgPayload,
    litellmTeamId: string,
  ): Promise<void> {
    for (const purpose of ORG_SERVICE_ACCOUNT_PURPOSES) {
      await this.ensureOrgCredential(orgPayload, litellmTeamId, purpose);
    }
  }

  private static async ensureOrgCredential(
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
      select: { status: true },
    });

    if (existing?.status === OrgLLMServiceAccountCredentialStatus.ACTIVE) {
      return;
    }

    const orgName = orgPayload.name || orgPayload.spacesOrgId;
    const serviceAccountName = `${purpose}-${orgName}-service-account`;
    const orgSlug = slugify(orgName);
    const purposeSlug = purpose.toLowerCase().replace(/_/g, '-');
    const litellmUserId = `claw-service-account-${orgPayload.spacesOrgId}-${purpose}`;
    const externalUserId = `${orgPayload.spacesOrgId}-${purpose}`;

    await this.storeOrgCredential({
      orgPayload,
      litellmTeamId,
      purpose,
      status: OrgLLMServiceAccountCredentialStatus.PENDING,
      litellmUserId,
      keyAlias: serviceAccountName,
      serviceAccountName,
    });

    try {
      await litellmProvisioningClient.createUser({
        orgId: orgPayload.spacesOrgId,
        userId: externalUserId,
        email: `${purposeSlug}@${orgSlug}-service-account`,
        name: serviceAccountName,
        teamId: litellmTeamId,
        litellmUserId,
        metadata: { purpose, source: 'xyne-spaces', service_account: true },
      });
    } catch (error) {
      if (error instanceof LiteLLMProvisioningError && error.statusCode === 409) {
        logger.info(`[AiProvisioningBackfill] Service account user already exists for ${purpose}, continuing`);
      } else {
        throw error;
      }
    }

    const key = await litellmProvisioningClient.generateKey({
      orgId: orgPayload.spacesOrgId,
      userId: externalUserId,
      email: `${purposeSlug}@${orgSlug}-service-account`,
      litellmUserId,
      teamId: litellmTeamId,
      keyAlias: serviceAccountName,
      metadata: { purpose, source: 'xyne-spaces', service_account: true },
    });

    await this.storeOrgCredential({
      orgPayload,
      litellmTeamId,
      purpose,
      status: OrgLLMServiceAccountCredentialStatus.ACTIVE,
      litellmUserId,
      key: key.key,
      tokenId: key.tokenId,
      keyName: key.keyName,
      keyAlias: key.keyAlias,
      serviceAccountName,
      expires: key.expires,
    });
  }

  private static async storeOrgCredential(params: {
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
    expires?: string;
  }): Promise<void> {
    const { orgPayload, litellmTeamId, purpose, status, ...rest } = params;
    const now = new Date();
    const credentials: OrgLiteLLMServiceAccountCredentials = {
      source: 'xyne-spaces',
      litellmTeamId,
      ...rest,
      providerUrl: config.litellm.baseUrl,
      defaultModel: config.aiProvisioning.orgDefaultModels[0] ?? null,
      defaultModels: config.aiProvisioning.orgDefaultModels,
      teamAlias: orgPayload.name,
      purpose,
      provisionedAt: now.toISOString(),
    };

    const encrypted = encrypt(JSON.stringify(credentials));

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
        credentials: encrypted,
        status,
        lastProvisionedAt: status === OrgLLMServiceAccountCredentialStatus.ACTIVE ? now : null,
        createdAt: now,
        updatedAt: now,
      },
      update: {
        credentials: encrypted,
        status,
        lastProvisionedAt: status === OrgLLMServiceAccountCredentialStatus.ACTIVE ? now : null,
        updatedAt: now,
      },
    });
  }

  // ── WORKSPACE PROVISIONING ────────────────────────────────────────────

  private static async provisionWorkspace(workspaceId: string): Promise<void> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        orgId: true,
        name: true,
        description: true,
        createdBy: true,
        status: true,
        organization: { select: { name: true } },
      },
    });
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    const workspacePayload: ClawSyncWorkspacePayload = {
      spacesWorkspaceId: workspace.id,
      spacesOrgId: workspace.orgId,
      name: workspace.name,
      orgName: workspace.organization.name,
      description: workspace.description,
      createdBySpacesUserId: workspace.createdBy,
      status: workspace.status,
    };

    await clawSpacesSyncClient.syncWorkspace(workspacePayload);
  }

  // ── USER PROVISIONING ────────────────────────────────────────────────

  private static async provisionUser(orgMemberId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { orgMemberId, leftAt: null },
      orderBy: { createdAt: 'asc' },
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
      throw new Error(`No active workspace user found for org member: ${orgMemberId}`);
    }

    const orgId = user.workspace.orgId;
    const teamId = await this.getOrgLiteLLMTeamId(orgId);
    if (!teamId) {
      throw new Error(`Org ${orgId} has no LiteLLM team — provision orgs first`);
    }

    const workspaceType = user.workspace.workspaceType ?? null;
    const budget = this.getUserBudget(workspaceType);

    const clawUserPayload: ClawSyncUserPayload = {
      spacesUserId: user.id,
      spacesWorkspaceId: user.workspace.id,
      spacesOrgId: orgId,
      spacesOrgMemberId: user.orgMemberId,
      email: user.email,
      name: user.name,
      role: user.role,
      workspaceName: user.workspace.name,
      orgName: user.workspace.organization.name,
      createdBySpacesUserId: user.workspace.createdBy,
      status: user.status,
    };

    await clawSpacesSyncClient.syncUser(clawUserPayload);

    const litellmUserId = `claw-user-${user.orgMemberId}`;

    try {
      await litellmProvisioningClient.createUser({
        orgId,
        userId: user.orgMemberId,
        email: user.email,
        name: user.name,
        teamId,
        budget,
        litellmUserId,
      });
    } catch (error) {
      if (error instanceof LiteLLMProvisioningError && error.statusCode === 409) {
        logger.info(`[AiProvisioningBackfill] LiteLLM user already exists for org member ${user.orgMemberId}, continuing`);
      } else {
        throw error;
      }
    }

    const key = await litellmProvisioningClient.generateKey({
      orgId,
      userId: user.orgMemberId,
      email: user.email,
      litellmUserId,
      teamId,
      budget,
    });

    await litellmProvisioningClient.storeUserKey({
      userId: user.orgMemberId,
      orgId,
      spacesOrgId: orgId,
      spacesWorkspaceId: user.workspace.id,
      spacesOrgMemberId: user.orgMemberId,
      litellmUserId,
      teamId,
      key: key.key,
      tokenId: key.tokenId,
      keyName: key.keyName,
      keyAlias: key.keyAlias,
      expires: key.expires,
    });
  }

  private static getUserBudget(workspaceType: string | null | undefined): number | undefined {
    const budget = workspaceType === WorkspaceType.COMMUNITY
      ? config.aiProvisioning.communityWorkspaceUserBudget
      : config.aiProvisioning.enterpriseWorkspaceUserBudget;
    return budget ?? undefined;
  }

  // ── BATCH RUNNER ─────────────────────────────────────────────────────

  private static async runBatched<T>(
    items: T[],
    getId: (item: T) => string,
    process: (item: T) => Promise<void>,
    isAlreadyDone: (id: string) => Promise<boolean>,
    markDone: (id: string) => Promise<void>,
    markFailed: (id: string, error: string) => Promise<void>,
    batchSize: number,
    dryRun: boolean,
  ): Promise<{ summary: SubjectSummary; errors: Array<{ id: string; error: string }> }> {
    const summary: SubjectSummary = { total: items.length, skipped: 0, success: 0, errors: 0 };
    const errors: Array<{ id: string; error: string }> = [];

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (item) => {
          const id = getId(item);

          if (await isAlreadyDone(id)) {
            summary.skipped++;
            return;
          }

          if (dryRun) {
            summary.success++;
            return;
          }

          try {
            await process(item);
            await markDone(id);
            summary.success++;
          } catch (error) {
            summary.errors++;
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.error(`[AiProvisioningBackfill] Failed to provision ${id}:`, error);
            errors.push({ id, error: errorMsg });
            await markFailed(id, errorMsg);
          }
        }),
      );
    }

    return { summary, errors };
  }

  // ── ENTRY POINT ──────────────────────────────────────────────────────

  static async triggerBackfill(req: Request, res: Response<ApiResponse>) {
    try {
      const options = this.buildOptions(req.body);
      logger.info('[AiProvisioningBackfill] Starting', options);

      const result: BackfillResult = {
        mode: options.mode,
        summary: { total: 0, skipped: 0, success: 0, errors: 0 },
        errors: [],
      };

      if (options.mode === 'orgs') {
        const orgs = await this.prisma.organization.findMany({
          select: { orgId: true },
          orderBy: { orgId: 'asc' },
        });

        const batchResult = await this.runBatched<{ orgId: string }>(
          orgs,
          (o) => o.orgId,
          (o) => this.provisionOrg(o.orgId),
          (id) => this.isProvisioned(AIProvisioningSubjectType.ORG, id),
          (id) => this.markStatus(AIProvisioningSubjectType.ORG, id, AIProvisioningStatusValue.SUCCESS),
          (id, err) => this.markStatus(AIProvisioningSubjectType.ORG, id, AIProvisioningStatusValue.FAILED, err),
          1,
          options.dryRun,
        );
        result.summary = batchResult.summary;
        result.errors = batchResult.errors;
      } else if (options.mode === 'workspaces') {
        const workspaces = await this.prisma.workspace.findMany({
          select: { id: true },
          orderBy: { id: 'asc' },
        });

        const batchResult = await this.runBatched<{ id: string }>(
          workspaces,
          (w) => w.id,
          (w) => this.provisionWorkspace(w.id),
          (id) => this.isProvisioned(AIProvisioningSubjectType.WORKSPACE, id),
          (id) => this.markStatus(AIProvisioningSubjectType.WORKSPACE, id, AIProvisioningStatusValue.SUCCESS),
          (id, err) => this.markStatus(AIProvisioningSubjectType.WORKSPACE, id, AIProvisioningStatusValue.FAILED, err),
          1,
          options.dryRun,
        );
        result.summary = batchResult.summary;
        result.errors = batchResult.errors;
      } else if (options.mode === 'users') {
        const users = await this.prisma.orgMember.findMany({
          where: {
            leftAt: null,
            users: { some: { leftAt: null } },
          },
          select: { memberId: true },
          orderBy: { memberId: 'asc' },
        });

        const batchResult = await this.runBatched<{ memberId: string }>(
          users,
          (u) => u.memberId,
          (u) => this.provisionUser(u.memberId),
          (id) => this.isProvisioned(AIProvisioningSubjectType.USER, id),
          (id) => this.markStatus(AIProvisioningSubjectType.USER, id, AIProvisioningStatusValue.SUCCESS),
          (id, err) => this.markStatus(AIProvisioningSubjectType.USER, id, AIProvisioningStatusValue.FAILED, err),
          options.batchSize,
          options.dryRun,
        );
        result.summary = batchResult.summary;
        result.errors = batchResult.errors;
      }

      res.status(200).json({
        success: true,
        message: `AI provisioning backfill completed for ${options.mode}${options.dryRun ? ' (dry run)' : ''}`,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('[AiProvisioningBackfill] Error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run backfill',
        timestamp: new Date().toISOString(),
      });
    }
  }

  static async getStatus(_req: Request, res: Response<ApiResponse>) {
    try {
      const [orgs, workspaces, users] = await Promise.all([
        this.prisma.organization.count(),
        this.prisma.workspace.count(),
        this.prisma.user.count(),
      ]);

      const [orgsDone, workspacesDone, usersDone] = await Promise.all([
        this.prisma.aiProvisioningStatus.count({
          where: { subjectType: AIProvisioningSubjectType.ORG, status: AIProvisioningStatusValue.SUCCESS },
        }),
        this.prisma.aiProvisioningStatus.count({
          where: { subjectType: AIProvisioningSubjectType.WORKSPACE, status: AIProvisioningStatusValue.SUCCESS },
        }),
        this.prisma.aiProvisioningStatus.count({
          where: { subjectType: AIProvisioningSubjectType.USER, status: AIProvisioningStatusValue.SUCCESS },
        }),
      ]);

      res.status(200).json({
        success: true,
        data: {
          orgs: { total: orgs, provisioned: orgsDone, unprovisioned: orgs - orgsDone },
          workspaces: { total: workspaces, provisioned: workspacesDone, unprovisioned: workspaces - workspacesDone },
          users: { total: users, provisioned: usersDone, unprovisioned: users - usersDone },
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('[AiProvisioningBackfill] Error fetching status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch status',
        timestamp: new Date().toISOString(),
      });
    }
  }
}
