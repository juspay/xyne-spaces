import {
  OrgLLMServiceAccountCredentialStatus,
  OrgLLMServiceAccountProvider,
  OrgLLMServiceAccountPurpose,
} from '@xyne/shared';
import { config } from '@/config/env';
import { DatabaseClient } from '@/database/client';
import { decrypt } from '@/services/encryptionService';
import { logger } from '@/utils/logger';

const CACHE_TTL_MS = 5 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 30 * 1000;

type CachedCredential = {
  expiresAt: number;
  value: OrgLLMCredential | null;
};

interface StoredOrgLLMCredentials {
  key?: string;
  providerUrl?: string;
  defaultModel?: string | null;
  defaultModels?: string[];
}

export interface OrgLLMCredential {
  apiKey: string;
  baseUrl: string;
  defaultModel: string | null;
  defaultModels?: string[];
  purpose: OrgLLMServiceAccountPurpose;
}

class OrgLLMCredentialService {
  private prisma = DatabaseClient.getInstance();
  private cache = new Map<string, CachedCredential>();

  async getCredential(
    orgId: string | null | undefined,
    purpose: OrgLLMServiceAccountPurpose,
  ): Promise<OrgLLMCredential | null> {
    if (!orgId) {
      return this.getEnvFallbackCredential(purpose);
    }

    const preferred = await this.getCredentialForPurpose(orgId, purpose);
    if (preferred) {
      return preferred;
    }

    if (purpose === OrgLLMServiceAccountPurpose.DEFAULT) {
      return this.getEnvFallbackCredential(purpose);
    }

    const fallback = await this.getCredentialForPurpose(orgId, OrgLLMServiceAccountPurpose.DEFAULT);
    if (fallback) {
      return fallback;
    }

    return this.getEnvFallbackCredential(purpose);
  }

  async getCredentialByOrgId(
    orgId: string | null | undefined,
    purpose: OrgLLMServiceAccountPurpose,
  ): Promise<OrgLLMCredential | null> {
    return this.getCredential(orgId, purpose);
  }

  async getCredentialByUserId(
    userId: string | null | undefined,
    purpose: OrgLLMServiceAccountPurpose,
  ): Promise<OrgLLMCredential | null> {
    if (!userId) {
      return this.getEnvFallbackCredential(purpose);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        workspace: {
          select: { orgId: true },
        },
      },
    });

    return this.getCredential(user?.workspace?.orgId, purpose);
  }

  async getCredentialByWorkspaceId(
    workspaceId: string | null | undefined,
    purpose: OrgLLMServiceAccountPurpose,
  ): Promise<OrgLLMCredential | null> {
    if (!workspaceId) {
      return this.getEnvFallbackCredential(purpose);
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { orgId: true },
    });

    return this.getCredential(workspace?.orgId, purpose);
  }

  async getCredentialByProjectId(
    projectId: string | null | undefined,
    purpose: OrgLLMServiceAccountPurpose,
  ): Promise<OrgLLMCredential | null> {
    if (!projectId) {
      return this.getEnvFallbackCredential(purpose);
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        workspace: {
          select: { orgId: true },
        },
      },
    });

    return this.getCredential(project?.workspace?.orgId, purpose);
  }

  async getCredentialByTicketId(
    ticketId: string | null | undefined,
    purpose: OrgLLMServiceAccountPurpose,
  ): Promise<OrgLLMCredential | null> {
    if (!ticketId) {
      return this.getEnvFallbackCredential(purpose);
    }

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        project: {
          select: {
            workspace: {
              select: { orgId: true },
            },
          },
        },
      },
    });

    return this.getCredential(ticket?.project?.workspace?.orgId, purpose);
  }

  async getCredentialByChannelId(
    channelId: string | null | undefined,
    purpose: OrgLLMServiceAccountPurpose,
  ): Promise<OrgLLMCredential | null> {
    if (!channelId) {
      return this.getEnvFallbackCredential(purpose);
    }

    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: {
        project: {
          select: {
            workspace: {
              select: { orgId: true },
            },
          },
        },
      },
    });

    return this.getCredential(channel?.project?.workspace?.orgId, purpose);
  }

  async getCredentialByVespaDocId(
    vespaDocId: string | null | undefined,
    purpose: OrgLLMServiceAccountPurpose,
  ): Promise<OrgLLMCredential | null> {
    if (!vespaDocId) {
      return this.getEnvFallbackCredential(purpose);
    }

    const attachment = await this.prisma.messageAttachment.findUnique({
      where: { id: vespaDocId },
      select: { workspaceId: true },
    });
    if (attachment?.workspaceId) {
      return this.getCredentialByWorkspaceId(attachment.workspaceId, purpose);
    }

    const collectionItem = await this.prisma.collectionItem.findFirst({
      where: {
        fileId: vespaDocId,
        isLatest: true,
        deletedAt: null,
      },
      select: {
        collection: {
          select: {
            scopeType: true,
            scopeId: true,
          },
        },
      },
    });
    if (collectionItem?.collection?.scopeType === 'CHANNEL') {
      return this.getCredentialByChannelId(collectionItem.collection.scopeId, purpose);
    }

    return this.getCredentialByTicketId(vespaDocId, purpose);
  }

  invalidate(orgId: string, purpose?: OrgLLMServiceAccountPurpose): void {
    if (purpose) {
      this.cache.delete(this.cacheKey(orgId, purpose));
      return;
    }

    for (const key of this.cache.keys()) {
      if (key.startsWith(`${orgId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  private async getCredentialForPurpose(
    orgId: string,
    purpose: OrgLLMServiceAccountPurpose,
  ): Promise<OrgLLMCredential | null> {
    const key = this.cacheKey(orgId, purpose);
    const cached = this.cache.get(key);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const row = await this.prisma.orgLLMServiceAccountCredential.findUnique({
      where: {
        orgId_provider_purpose: {
          orgId,
          provider: OrgLLMServiceAccountProvider.LITELLM,
          purpose,
        },
      },
      select: {
        credentials: true,
        status: true,
        purpose: true,
      },
    });

    if (!row || row.status !== OrgLLMServiceAccountCredentialStatus.ACTIVE) {
      this.cache.set(key, {
        value: null,
        expiresAt: now + NEGATIVE_CACHE_TTL_MS,
      });
      return null;
    }

    try {
      const parsed = JSON.parse(decrypt(row.credentials)) as StoredOrgLLMCredentials;
      if (!parsed.key || !parsed.providerUrl) {
        this.cache.set(key, {
          value: null,
          expiresAt: now + NEGATIVE_CACHE_TTL_MS,
        });
        return null;
      }

      const value: OrgLLMCredential = {
        apiKey: parsed.key,
        baseUrl: parsed.providerUrl,
        defaultModel: parsed.defaultModel ?? null,
        defaultModels: parsed.defaultModels,
        purpose: row.purpose as OrgLLMServiceAccountPurpose,
      };

      this.cache.set(key, {
        value,
        expiresAt: now + CACHE_TTL_MS,
      });
      return value;
    } catch (error) {
      logger.error('[OrgLLMCredentialService] Failed to read org LiteLLM credentials', {
        orgId,
        purpose,
        error: error instanceof Error ? error.message : String(error),
      });

      this.cache.set(key, {
        value: null,
        expiresAt: now + NEGATIVE_CACHE_TTL_MS,
      });
      return null;
    }
  }

  private getEnvFallbackCredential(
    purpose: OrgLLMServiceAccountPurpose,
  ): OrgLLMCredential | null {
    const apiKey = this.getEnvApiKeyForPurpose(purpose);
    const baseUrl = config.litellm.baseUrl;

    if (!apiKey) {
      logger.warn('[OrgLLMCredentialService] env fallback requested but env not configured', {
        purpose,
      });
      return null;
    }

    logger.warn('[OrgLLMCredentialService] using env credential (no org-provisioned key in DB)', {
      purpose,
    });

    return {
      apiKey,
      baseUrl: baseUrl || '',
      defaultModel: null,
      purpose,
    };
  }

  private getEnvApiKeyForPurpose(purpose: OrgLLMServiceAccountPurpose): string {
    switch (purpose) {
      case OrgLLMServiceAccountPurpose.ASK_AI:
        return config.litellm.askAiApiKey;
      case OrgLLMServiceAccountPurpose.CALL_TRANSCRIPT:
        return config.llm.callLitellmApiKey;
      case OrgLLMServiceAccountPurpose.ACTIVITY_CLASSIFICATION:
        return config.activityClassification.litellmApiKey || config.litellm.apiKey;
      default:
        return config.litellm.apiKey;
    }
  }

  private cacheKey(orgId: string, purpose: OrgLLMServiceAccountPurpose): string {
    return `${orgId}:${purpose}`;
  }
}

export const orgLLMCredentialService = new OrgLLMCredentialService();
