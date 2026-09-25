import { transaction } from '../base';
import { db } from '@/database/client';
import { ReleaseReportService } from '@/services/releaseReports/releaseReportService';
import { type User } from '@prisma/client';
import type { ReleaseReport } from '@xyne/shared';
import { advisoryXactLock } from '@/bypassAcl/lockServices';


export function publishTx(ticketId: string, self: ReleaseReportService, publisher: User, report: ReleaseReport) {
  return transaction([], 'publish: advisory lock guarding concurrent report publish must commit atomically; tx is not ACL-wrapped', db, 
    async (tx) => {
      await advisoryXactLock(tx, ['Ticket'],
        'release report: serialize publishing of one ticket\'s release report',
        'release-report:' + ticketId);
      return self.publishLocked(ticketId, publisher, report);
    },
    { maxWait: 10_000, timeout: 60_000 }
  );
}
