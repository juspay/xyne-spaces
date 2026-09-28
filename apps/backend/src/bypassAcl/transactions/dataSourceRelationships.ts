import { Prisma } from '@prisma/client';
import { transaction } from '../base';
import { DataSourceRelationshipRepository } from '@/database/repositories/dataSourceRelationships';


export function replaceForDataSourceTx(self: DataSourceRelationshipRepository, dataSourceId: string, rows: Prisma.DataSourceRelationshipUncheckedCreateInput[]) {
  return transaction(['DataSourceRelationship'], 'replaceForDataSource: relationship deleteMany plus createMany must commit atomically; tx is not ACL-wrapped', self.db, async (tx) => {
    await tx.dataSourceRelationship.deleteMany({ where: { dataSourceId } });
    if (rows.length === 0) return 0;
    const result = await tx.dataSourceRelationship.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return result.count;
  });
}
