import { transaction } from '../base';
import { TeamIntelligenceRepository, CreateTeamIntelligenceBatchData, CreateTeamIntelligenceUserData } from '@/team-intelligence/repositories/team-intelligence.repository';
import { Prisma } from '@prisma/client';


export function createBatchWithUsersTx(self: TeamIntelligenceRepository, batchData: CreateTeamIntelligenceBatchData, usersData: CreateTeamIntelligenceUserData[]) {
  return transaction(['TeamIntelligenceIngestionBatchV2', 'TeamIntelligenceUserIngestionV2'], 'createBatchWithUsers: ingestion batch plus user rows must commit atomically; tx is not ACL-wrapped', self.prisma, async (transaction) => {
    const batch = await transaction.teamIntelligenceIngestionBatchV2.create({
      data: {
        ...batchData,
        requestPayload: batchData.requestPayload ?? Prisma.JsonNull,
      },
    });

    const users = await Promise.all(
      usersData.map((userData) =>
        transaction.teamIntelligenceUserIngestionV2.create({
          data: {
            ...userData,
            aiUsage: userData.aiUsage ?? Prisma.JsonNull,
            batchId: batch.id,
          },
        })
      )
    );

    return { batch, users };
  });
}
