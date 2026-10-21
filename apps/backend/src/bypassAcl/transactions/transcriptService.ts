import { transaction, type TableName } from '../base';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { Prisma } from '@prisma/client';

/**
 * Serializable transaction retried on a write conflict (P2034), same pattern as the sharing
 * services. Private so only the named operations in this file use it, each passing its own tables.
 */
async function runTransaction<T>(
  tables: TableName[],
  reason: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await transaction(tables, reason, db, operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const isWriteConflict = (error as { code?: string } | null)?.code === 'P2034';
      if (!isWriteConflict || attempt === 3) throw error;
    }
  }
  throw new Error('Call message title transaction retry limit exceeded');
}

/**
 * Writes the AI-generated title onto the call message and keeps the original "call ended" text in
 * metadata. No raw SQL: `content` is read through Prisma so the field-encryption extension
 * decrypts it. The previous raw `SELECT "content" ... FOR UPDATE` returned ciphertext, which ended
 * up in `metadata.callEndedText` and rendered as garbage on the call bubble.
 */
export function processCallWithSummaryTx(messageId: string, title: string) {
  return runTransaction(['Message'], 'processCallWithSummary: call message title update must commit atomically; tx is not ACL-wrapped', async (tx) => {
      const message = await tx.message.findUnique({
        where: { messageId },
        select: { content: true, metadata: true },
      });
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
