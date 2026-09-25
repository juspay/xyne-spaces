import { transaction } from '../base';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { lockMessageContentAndMetadata } from '@/bypassAcl/rowLockServices';


export function processCallWithSummaryTx(messageId: string, title: string) {
  return transaction(['Message'], 'processCallWithSummary: call message title update under row lock must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    const message = await lockMessageContentAndMetadata(tx, messageId);
    if (!message) {
      logger.warn(`Call message ${messageId} not found for title update`);
      return;
    }
    await tx.message.update({
      where: { messageId },
      data: {
        content: title,
        metadata: {
          ...(message.metadata as any),
          callTitle: title,
          callEndedText: message.content,
        },
      },
    });
  });
}
