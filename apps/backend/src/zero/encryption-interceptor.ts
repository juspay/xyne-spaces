import type { Transaction } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';

export function wrapTransactionWithEncryption(
  tx: Transaction<Schema>,
  _options: { workspaceId: string; mutatorName?: string },
): Transaction<Schema> {
  return tx;
}

/**
 * Decrypt server-encrypted strings in a query result that was read outside Zero's `run`
 * path (replica fallback, zql-to-sql, catalog HTTP). Pass-through in the public build.
 */
export async function decryptQueryResult<T>(result: T, _options: { queryName: string }): Promise<T> {
  return result;
}
