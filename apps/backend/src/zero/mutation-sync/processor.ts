import type { Transaction } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import type { QueryContext, TableName } from '../acl/core/types';
import type { MutationSyncOperation } from './types';
import { mutationSyncHandlers } from './handlers';

export async function mutationSyncProcessor(
  table: TableName,
  operation: MutationSyncOperation,
  args: unknown,
  tx: Transaction<Schema>,
  ctx: QueryContext,
  previousValue?: unknown
): Promise<void> {
  const handlerFactory = mutationSyncHandlers[table];
  if (!handlerFactory) {
    return;
  }

  const handler = handlerFactory(ctx);
  switch (operation) {
    case 'insert':
      await handler.onInsert(args, tx, previousValue);
      return;
    case 'update':
      await handler.onUpdate(args, tx, previousValue);
      return;
    case 'delete':
      await handler.onDelete(args, tx, previousValue);
      return;
    case 'upsert':
      await handler.onUpsert(args, tx, previousValue);
      return;
    default:
      return;
  }
}
