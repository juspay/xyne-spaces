import type { Transaction } from '@rocicorp/zero';
import type { QueryContext, TableName } from '../core/types';
import { ACLFactory } from '../core/acl-factory';
import { Schema } from '@xyne/shared';
import {
  collectVespaJobs,
  type VespaJobsAccumulator,
  type VespaOperation
} from '../../vespa-injection';
import {
  collectSideEffectJobs,
  createSideEffectJobsAccumulator,
  type SideEffectJobsAccumulator,
  type SideEffectOperation,
} from '../../side-effects';
import { mutationSyncProcessor } from '../../mutation-sync/processor';
import { collectMutationSyncPreviousValue } from '../../mutation-sync/config';
import type { MutationSyncOperation } from '../../mutation-sync/types';

/**
 * Wraps a Zero transaction with ACL checks and Vespa/side-effect job collection.
 * 
 * This creates a Proxy that intercepts the `mutate` property to apply ACL validation
 * before mutations execute. All other transaction properties (including methods that
 * access private fields like #schema and #serverSchema) are properly bound to the
 * original target to maintain correct `this` context for private field access.
 * 
 * @param tx - The Zero transaction to wrap
 * @param ctx - Query context with user information for ACL checks
 * @param vespaJobs - Accumulator for collecting Vespa indexing jobs
 * @param sideEffectJobs - Accumulator for collecting side effect jobs
 * @returns Proxied transaction with ACL and job collection applied
 */
export function wrapTransactionWithACL(
  tx: Transaction<Schema>,
  ctx: QueryContext | undefined,
  vespaJobs: VespaJobsAccumulator,
  sideEffectJobs: SideEffectJobsAccumulator,
): Transaction<Schema> {
  if (!ctx) {
    throw new Error('QueryContext is required for ACL wrapping');
  }

  return new Proxy(tx, {
    get(target, prop: string | symbol, receiver) {
      if (prop === 'mutate') {
        return wrapMutateWithACL(target.mutate, ctx, tx, vespaJobs, sideEffectJobs);
      }
      
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return value.bind(target);
      }
      
      return value;
    }
  }) as Transaction<Schema>;
}

/**
 * Wraps the tx.mutate object (SchemaCRUD) to intercept table operations
 * for both ACL checks and Vespa job collection
 */
function wrapMutateWithACL(
  mutate: Transaction<Schema>['mutate'],
  ctx: QueryContext,
  tx: Transaction<Schema>,
  vespaJobs: VespaJobsAccumulator,
  sideEffectJobs: SideEffectJobsAccumulator,
): Transaction<Schema>['mutate'] {
  return new Proxy(mutate, {
    get(target, tableName: string | symbol, receiver) {
      if (typeof tableName !== 'string') {
        return Reflect.get(target, tableName, receiver);
      }

      const tableOps = Reflect.get(target, tableName, receiver);

      // Wrap table operations (insert, update, delete, upsert)
      return new Proxy(tableOps as Record<string, unknown>, {
        get(ops, operation: string | symbol, opReceiver) {
          if (typeof operation !== 'string') {
            return Reflect.get(ops, operation, opReceiver);
          }

          const originalOp = Reflect.get(ops, operation, opReceiver);

          if (typeof originalOp !== 'function') {
            return originalOp;
          }

          return async function (this: unknown, args: unknown) {
            let previousValue: unknown = undefined;

            // 1. ACL Check (throws if unauthorized)
            const acl = await ACLFactory.getACL(tableName as TableName, ctx);
            const operationMethod = acl[`can${operation.charAt(0).toUpperCase()}${operation.slice(1)}` as keyof typeof acl];
            if (typeof operationMethod === 'function') {
              await (operationMethod as any).call(acl, args, tx);
            }

            const vespaOperation = operation as VespaOperation;
            const sideEffectOperation = operation as SideEffectOperation;
            const stagedSideEffectJobs = createSideEffectJobsAccumulator();

            // Capture side-effect previous state before the write, but only
            // publish the job if the write succeeds.
            if (['insert', 'update', 'upsert', 'delete'].includes(sideEffectOperation)) {
              await collectSideEffectJobs(tableName as TableName, sideEffectOperation, args, tx, stagedSideEffectJobs);
            }

            previousValue = await collectMutationSyncPreviousValue(
              tableName as TableName,
              operation as MutationSyncOperation,
              args,
              tx
            );

            // 4. Execute original mutation (if ACL passes)
            const result = await (originalOp as (this: unknown, value: unknown) => Promise<unknown>).call(this, args);

            // 5. Collect jobs only after the mutation succeeds.
            if (['insert', 'update', 'upsert', 'delete'].includes(vespaOperation)) {
              collectVespaJobs(tableName as TableName, vespaOperation, args, tx, ctx, vespaJobs);
            }
            sideEffectJobs.push(...stagedSideEffectJobs);

            await mutationSyncProcessor(
              tableName as TableName,
              operation as MutationSyncOperation,
              args,
              tx,
              ctx,
              previousValue
            );

            return result;
          };
        }
      });
    }
  }) as Transaction<Schema>['mutate'];
}
