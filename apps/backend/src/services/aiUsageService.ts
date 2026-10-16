import {
  OrgLLMServiceAccountCredentialStatus,
  OrgLLMServiceAccountProvider,
  OrgLLMServiceAccountPurpose,
} from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { decrypt } from '@/services/encryptionService';
import { logger } from '@/utils/logger';
import { LiteLLMBudgetInfo, litellmProvisioningClient } from '@/services/litellmProvisioningClient';

export interface AiBudgetUsage extends LiteLLMBudgetInfo {
  remaining: number | null;
}

export interface OrgAiUsage {
  provisioned: boolean;
  org: AiBudgetUsage | null;
  user: AiBudgetUsage | null;
}

class AiUsageService {
  private prisma = DatabaseClient.getInstance();

  /**
   * Org budget comes from the org's LiteLLM team, the member's from their LiteLLM user.
   * The org budget is only read for owners and admins; members get their own usage only.
   */
  async getOrgUsage(orgId: string, orgMemberId: string, includeOrg: boolean): Promise<OrgAiUsage> {
    const teamId = await this.getTeamId(orgId);
    if (!teamId) {
      return { provisioned: false, org: null, user: null };
    }

    const [org, user] = await Promise.all([
      includeOrg
        ? litellmProvisioningClient
            .getTeamBudgetInfo(teamId)
            .catch((error) => logUnavailable('team', orgId, error))
        : null,
      litellmProvisioningClient
        .getUserBudgetInfo(`claw-user-${orgMemberId}`)
        .catch((error) => logUnavailable('user', orgId, error)),
    ]);
    return { provisioned: true, org: withRemaining(org), user: withRemaining(user) };
  }

  private async getTeamId(orgId: string): Promise<string | null> {
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

    const parsed = JSON.parse(decrypt(credential.credentials)) as { litellmTeamId?: unknown };
    return typeof parsed.litellmTeamId === 'string' && parsed.litellmTeamId.trim()
      ? parsed.litellmTeamId
      : null;
  }
}

function logUnavailable(scope: 'team' | 'user', orgId: string, error: unknown): null {
  logger.warn(`[AiUsage] Could not read LiteLLM ${scope} budget for org ${orgId}`, {
    error: error instanceof Error ? error.message : String(error),
  });
  return null;
}

function withRemaining(info: LiteLLMBudgetInfo | null): AiBudgetUsage | null {
  if (!info) return null;
  return {
    ...info,
    remaining: info.maxBudget === null ? null : Math.max(info.maxBudget - info.spend, 0),
  };
}

export const aiUsageService = new AiUsageService();
