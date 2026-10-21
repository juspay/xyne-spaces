import { transaction } from '../base';
import { db } from '@/database/client';
import { CreateDataSourceInput } from '@/services/dynamicDashboard/dataSource/DataSourceService';


export function createTx(input: CreateDataSourceInput, ciphertext: string) {
  return transaction(['DashboardActivity', 'DataSource'], 'create: data source row and dashboard activity row must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    const created = await tx.dataSource.create({
      data: {
        workspaceId: input.workspaceId,
        name: input.name,
        description: input.description,
        sourceType: input.sourceType,
        credentials: ciphertext,
        healthStatus: 'healthy',
        ingestionStatus: 'pending',
        createdBy: input.createdBy,
      },
    });
    await tx.dashboardActivity.create({
      data: {
        workspaceId: input.workspaceId,
        entityType: 'data_source',
        entityId: created.id,
        eventType: 'created',
        actorUserId: input.createdBy,
        details: JSON.stringify({
          sourceType: input.sourceType,
          name: input.name,
        }),
      },
    });
    return created;
  });
}
export function requestRefreshTx(id: string, workspaceId: string, actorUserId: string) {
  return transaction(['DashboardActivity', 'DataSource'], 'requestRefresh: data source status update and dashboard activity row must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    await tx.dataSource.update({
      where: { id },
      data: { ingestionStatus: 'pending' },
    });
    await tx.dashboardActivity.create({
      data: {
        workspaceId,
        entityType: 'data_source',
        entityId: id,
        eventType: 'refresh_requested',
        actorUserId,
      },
    });
  });
}
