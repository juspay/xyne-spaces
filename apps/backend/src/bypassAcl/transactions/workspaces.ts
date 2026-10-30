import { transaction } from '../base';
import { WorkspaceRepository } from '@/database/repositories/workspaces';
import { getEncryptionProvider } from '@/services/encryption';
import { WorkspaceType } from '@xyne/shared';
import { Prisma } from '@prisma/client';


export function createTx(self: WorkspaceRepository, data: Prisma.WorkspaceCreateInput) {
  return transaction(['Workspace'], 'create: workspace creation must commit atomically; tx is not ACL-wrapped', self.db, async (tx) => {
    const workspace = await tx.workspace.create({
      data: {
        ...data,
        workspaceType: (data as any).workspaceType ?? WorkspaceType.ENTERPRISE,
      },
    });
    await getEncryptionProvider().provisionEntity({
      entityId: workspace.id,
      orgId: workspace.orgId,
      entityType: 'WORKSPACE',
    });
    return workspace;
  });
}
