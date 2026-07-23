import {
  AIProvisioningProvider,
  AIProvisioningStatus as AIProvisioningStatusValue,
  AIProvisioningSubjectType,
} from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { aiProvisioningQueue } from '@/queues/aiProvisioningQueue';

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
