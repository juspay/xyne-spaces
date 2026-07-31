import {
  AIProvisioningProvider,
  AIProvisioningStatus as AIProvisioningStatusValue,
  AIProvisioningSubjectType,
} from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { aiProvisioningQueue } from '@/queues/aiProvisioningQueue';
import { litellmProvisioningClient } from '@/services/litellmProvisioningClient';
import { logger } from '@/utils/logger';

class AIProvisioningService {
  private prisma = DatabaseClient.getInstance();

  async enqueueOrgSync(spacesOrgId: string) {
    return this.ensureStatusAndEnqueue(AIProvisioningSubjectType.ORG, spacesOrgId);
  }

  async enqueueWorkspaceSync(spacesWorkspaceId: string) {
    return this.ensureStatusAndEnqueue(
      AIProvisioningSubjectType.WORKSPACE,
      spacesWorkspaceId,
    );
  }

  async enqueueUserSync(spacesUserId: string) {
    return this.ensureStatusAndEnqueue(AIProvisioningSubjectType.USER, spacesUserId);
  }

  async upgradeCommunityToEnterpriseBudget(orgMemberId: string): Promise<void> {
    const memberRow = await this.prisma.orgMember.findUnique({
      where: { memberId: orgMemberId },
      select: {
        memberId: true,
        users: {
          select: { id: true, leftAt: true },
          where: { leftAt: null },
        },
      },
    });

    if (!memberRow) return;

    const activeUserIds = memberRow.users.map(u => u.id);

    for (const userId of activeUserIds) {
      const litellmUserId = `claw-user-${userId}`;
      try {
        await litellmProvisioningClient.deleteUser(litellmUserId);
        logger.info('[AI-PROVISIONING-SERVICE] Deleted LiteLLM user for community→enterprise transition', {
          orgMemberId,
          userId,
          litellmUserId,
        });
      } catch (error) {
        logger.error('[AI-PROVISIONING-SERVICE] Failed to delete LiteLLM user for community→enterprise transition', {
          orgMemberId,
          userId,
          litellmUserId,
          error,
        });
      }

      await this.prisma.aiProvisioningStatus.updateMany({
        where: {
          subjectType: AIProvisioningSubjectType.USER,
          subjectId: userId,
          provider: AIProvisioningProvider.CLAW_LITELLM,
        },
        data: {
          status: AIProvisioningStatusValue.PENDING,
          lastError: null,
          updatedAt: new Date(),
        },
      });

      await this.enqueueUserSync(userId);
    }
  }

  private async ensureStatusAndEnqueue(
    subjectType: AIProvisioningSubjectType,
    subjectId: string,
  ) {
    const now = new Date();
    const provider = AIProvisioningProvider.CLAW_LITELLM;
    const existing = await this.prisma.aiProvisioningStatus.findUnique({
      where: {
        subjectType_subjectId_provider: {
          subjectType,
          subjectId,
          provider,
        },
      },
    });

    if (existing?.status === AIProvisioningStatusValue.SUCCESS) {
      return existing;
    }

    const status = existing
      ? await this.prisma.aiProvisioningStatus.update({
          where: { id: existing.id },
          data: {
            status: AIProvisioningStatusValue.PENDING,
            lastError: null,
            updatedAt: now,
          },
        })
      : await this.prisma.aiProvisioningStatus.create({
          data: {
            subjectType,
            subjectId,
            provider,
            status: AIProvisioningStatusValue.PENDING,
            attempts: 0,
            createdAt: now,
            updatedAt: now,
          },
        });

    await aiProvisioningQueue.enqueue({
      provisioningStatusId: status.id,
    });

    return status;
  }
}

export const aiProvisioningService = new AIProvisioningService();
