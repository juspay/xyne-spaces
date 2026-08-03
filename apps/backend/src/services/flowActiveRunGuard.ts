import { TicketStatusV2 } from '@prisma/client';

interface UpdateWhileFlowRunActiveInput<TTransaction, TResult> {
  runTransaction: (
    operation: (transaction: TTransaction) => Promise<TResult | null>
  ) => Promise<TResult | null>;
  lockAndReadRootStatus: (transaction: TTransaction) => Promise<TicketStatusV2 | null>;
  update: (transaction: TTransaction) => Promise<TResult>;
}

/**
 * Locks the root ticket and checks its status in the same transaction as the
 * child write. A concurrent pause/cancel either wins before this operation and
 * blocks the write, or waits until this operation commits.
 */
export function updateWhileFlowRunActive<TTransaction, TResult>(
  input: UpdateWhileFlowRunActiveInput<TTransaction, TResult>
): Promise<TResult | null> {
  return input.runTransaction(async (transaction) => {
    const status = await input.lockAndReadRootStatus(transaction);
    if (status !== TicketStatusV2.STARTED) return null;
    return input.update(transaction);
  });
}
