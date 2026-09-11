import type { Transaction } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';

export function wrapTransactionWithEncryption(
  tx: Transaction<Schema>,
  _options: { workspaceId: string; mutatorName?: string },
): Transaction<Schema> {
  return tx;
}
