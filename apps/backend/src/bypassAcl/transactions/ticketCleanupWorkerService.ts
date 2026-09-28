import { transaction } from '../base';
import { db } from '@/database/client';
import { MAX_RETRIES, BATCH_SIZE } from '@/services/tickets/descriptionCleaner/ticketCleanupWorkerService';
import { logger } from '@/utils/logger';
import { VespaOperationType, VespaInsertionStatus } from '@xyne/shared';


export function claimFailedCleanupLogsTx() {
  return transaction(['VespaInsertionLogs'], 'claimFailedCleanupLogs: failed cleanup-log claim from FAILED to PENDING must commit atomically; tx is not ACL-wrapped', db, async tx => {
    const logs = await tx.vespaInsertionLogs.findMany({
      where: {
        type: VespaOperationType.POST_INGEST_CLEAN,
        status: VespaInsertionStatus.FAILED,
        retryCount: { lt: MAX_RETRIES },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: BATCH_SIZE,
    });

    if (logs.length === 0) {
      return [];
    }

    const ids = logs.map(log => log.id);
    const claimResult = await tx.vespaInsertionLogs.updateMany({
      where: {
        id: { in: ids },
        status: VespaInsertionStatus.FAILED,
      },
      data: {
        status: VespaInsertionStatus.PENDING,
      },
    });

    if (claimResult.count !== ids.length) {
      logger.warn('[TicketCleanupWorker] Unexpected claim count while marking logs as PENDING', {
        requested: ids.length,
        updated: claimResult.count,
      });
    }

    return logs.map(log => ({
      ...log,
      status: VespaInsertionStatus.PENDING,
    }));
  });
}
