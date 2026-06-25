import type { Transaction } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import type { TableName, VespaJobsAccumulator } from './types';
import type { QueryContext } from '../../acl/core/types';
import { VespaHandlerFactory } from './handler-factory';

/**
 * Operation types that can trigger Vespa job collection
 */
export type VespaOperation = 'insert' | 'update' | 'upsert' | 'delete';

/**
 * Creates a new empty accumulator for collecting Vespa jobs during a transaction.
 * 
 * @returns An empty array to accumulate VespaJobConfig items
 * 
 * @example
 * ```typescript
 * const vespaJobs = createVespaJobsAccumulator();
 * // ... perform mutations, collect jobs ...
 * // After transaction commits, flush the jobs
 * ```
 */
export function createVespaJobsAccumulator(): VespaJobsAccumulator {
  return [];
}

/**
 * Collects Vespa jobs for a given table operation.
 * 
 * This function is called after a successful mutation to determine
 * if any Vespa indexing jobs need to be queued. The jobs are accumulated
 * in the provided accumulator array (passed by reference).
 * 
 * @param table - The table name being mutated
 * @param operation - The type of mutation operation
 * @param args - The mutation arguments (data being inserted/updated/deleted)
 * @param tx - The transaction context for any needed lookups
 * @param ctx - The query context with user info
 * @param accumulator - The array to accumulate jobs into (modified in place)
 * 
 * @example
 * ```typescript
 * const vespaJobs = createVespaJobsAccumulator();
 * const ctx = { userID: 'user_123' };
 * 
 * // After inserting a message
 * collectVespaJobs('messages', 'insert', messageData, tx, ctx, vespaJobs);
 * 
 * // vespaJobs now contains: [{ schema: 'chat_message', docId: '...', jobType: 'feed', ... }]
 * ```
 */
export function collectVespaJobs(
  table: TableName,
  operation: VespaOperation,
  args: any,
  tx: Transaction<Schema>,
  ctx: QueryContext,
  accumulator: VespaJobsAccumulator
): void {
  const handler = VespaHandlerFactory.getHandler(table, ctx);
  let jobs: VespaJobsAccumulator = [];

  switch (operation) {
    case 'insert':
      jobs = handler.onInsert(args, tx);
      break;
    case 'update':
      jobs = handler.onUpdate(args, tx);
      break;
    case 'upsert':
      jobs = handler.onUpsert(args, tx);
      break;
    case 'delete':
      jobs = handler.onDelete(args, tx);
      break;
  }

  // Accumulate jobs in place
  accumulator.push(...jobs);
}