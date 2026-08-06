import type { Transaction } from '@rocicorp/zero';
import type { QueryContext, TableName } from '../core/types';
import { ACLFactory } from '../core/acl-factory';
import { encryptedFieldsConfig, Schema, validateQueryWhereClause } from '@xyne/shared';
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
import {
  batchDecryptServerValues,
  batchEncryptServerValues,
} from '@/services/internal/encryption-client';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import {
  getCryptoMutationReEncryptLatency,
  getCryptoMutationDecryptRunLatency,
  getCryptoMutationOperations,
} from '@/services/otel/cryptoMetrics';

/**
 * Recursively decrypt server-encrypted fields from query results.
 * Handles strings, arrays, and objects.
 */
async function decryptRunResult(result: unknown): Promise<unknown> {
  if (typeof result === 'string') {
    const [decrypted] = await batchDecryptServerValues([result]);
    return decrypted;
  }

  const refs: Array<
    | { parent: unknown[]; key: number; value: string }
    | { parent: Record<string, unknown>; key: string; value: string }
  > = [];
  const cloned = cloneAndCollectEncryptedStrings(result, refs);
  const decrypted = await batchDecryptServerValues(refs.map((ref) => ref.value));
  for (const [index, ref] of refs.entries()) {
    if (Array.isArray(ref.parent)) {
      const arrayRef = ref as { parent: unknown[]; key: number; value: string };
      arrayRef.parent[arrayRef.key] = decrypted[index];
      continue;
    }
    const objectRef = ref as { parent: Record<string, unknown>; key: string; value: string };
    objectRef.parent[objectRef.key] = decrypted[index];
  }
  return cloned;
}

function cloneAndCollectEncryptedStrings(
  value: unknown,
  refs: Array<
    | { parent: unknown[]; key: number; value: string }
    | { parent: Record<string, unknown>; key: string; value: string }
  >,
): unknown {
  if (Array.isArray(value)) {
    const clonedArray = value.map((item) => cloneAndCollectEncryptedStrings(item, refs));
    clonedArray.forEach((item, index) => {
      if (typeof item === 'string' && item.startsWith('ENC:') && !item.startsWith('ENC:v1|sess|')) {
        refs.push({ parent: clonedArray, key: index, value: item });
      }
    });
    return clonedArray;
  }

  if (value && typeof value === 'object') {
    const clonedObject: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      clonedObject[key] = cloneAndCollectEncryptedStrings(nestedValue, refs);
      const candidate = clonedObject[key];
      if (typeof candidate === 'string' && candidate.startsWith('ENC:') && !candidate.startsWith('ENC:v1|sess|')) {
        refs.push({ parent: clonedObject, key, value: candidate });
      }
    }
    return clonedObject;
  }

  return value;
}

export function wrapTransactionWithEncryption(
  tx: Transaction<Schema>,
  options: { workspaceId: string; mutatorName?: string },
): Transaction<Schema> {
  if (!config.enc.enableDbEncryption) {
    return tx;
  }

  return new Proxy(tx, {
    get(target, prop: string | symbol) {
      if(prop === 'mutate'){
        return new Proxy(target.mutate, {
          get(mutateTarget, tableName: string | symbol) {
            if (typeof tableName !== 'string') {
              return Reflect.get(mutateTarget, tableName);
            }
            const tableOps = Reflect.get(mutateTarget, tableName);
            return new Proxy(tableOps as Record<string, unknown>, {
              get(table, operationName: string | symbol) {
                if (typeof operationName !== 'string') {
                  return Reflect.get(table, operationName);
                }
                const originalOp = Reflect.get(table, operationName);
                if (typeof originalOp !== 'function') {
                  return originalOp;
                }
                return async function (this: unknown, args: unknown) {
                  if (['insert', 'update', 'upsert'].includes(operationName)) {
                    const start = performance.now();
                    let reEncryptedArgs: unknown;
                    try {
                      reEncryptedArgs = await reEncryptForStorage(tableName, args, options.workspaceId);
                      const durationMs = performance.now() - start;
                      getCryptoMutationReEncryptLatency().record(durationMs, {
                        mutatorName: options.mutatorName ?? 'unknown',
                        table: tableName,
                        operation: operationName,
                      });
                      getCryptoMutationOperations().add(1, {
                        operation: 're_encrypt',
                        mutatorName: options.mutatorName ?? 'unknown',
                        status: 'success',
                      });
                      logger.info('Crypto re-encrypt latency recorded', {
                        event: 'crypto_mutation_re_encrypt_recorded',
                        durationMs,
                        mutatorName: options.mutatorName ?? 'unknown',
                        table: tableName,
                        operation: operationName,
                      });
                    } catch (err) {
                      getCryptoMutationOperations().add(1, {
                        operation: 're_encrypt',
                        mutatorName: options.mutatorName ?? 'unknown',
                        status: 'error',
                      });
                      logger.warn('Crypto re-encrypt operation failed', {
                        event: 'crypto_mutation_re_encrypt_error',
                        mutatorName: options.mutatorName ?? 'unknown',
                      });
                      throw err;
                    }
                    return await (originalOp as (this: unknown, value: unknown) => Promise<unknown>).call(this, reEncryptedArgs);
                  }
                  return await (originalOp as (this: unknown, value: unknown) => Promise<unknown>).call(this, args);
                }
              } 
            })
          }
        })
      }
      if (prop === 'run') {
        return async function (...args: unknown[]) {
          validateQueryWhereClause(args[0]);
          const result = await (target.run as (...args: unknown[]) => Promise<unknown>)(
            ...args,
          );
          const decryptStart = performance.now();
          try {
            const decrypted = await decryptRunResult(result);
            const durationMs = performance.now() - decryptStart;
            getCryptoMutationDecryptRunLatency().record(durationMs, {
              mutatorName: options.mutatorName ?? 'unknown',
            });
            getCryptoMutationOperations().add(1, {
              operation: 'decrypt_run',
              mutatorName: options.mutatorName ?? 'unknown',
              status: 'success',
            });
            logger.info('Crypto decrypt-run latency recorded', {
              event: 'crypto_mutation_decrypt_run_recorded',
              durationMs,
              mutatorName: options.mutatorName ?? 'unknown',
            });
            return decrypted;
          } catch (error) {
            getCryptoMutationOperations().add(1, {
              operation: 'decrypt_run',
              mutatorName: options.mutatorName ?? 'unknown',
              status: 'error',
            });
            logger.error('[encryptionlog] Failed to decrypt run result', {
              event: 'crypto_mutation_decrypt_run_error',
              error: error instanceof Error ? error.message : String(error),
            });
            return result;
          }
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
  }})
}

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
  mutatorName?: string,
): Transaction<Schema> {
  if (!ctx) {
    throw new Error('QueryContext is required for ACL wrapping');
  }

  const storageTx = wrapTransactionWithEncryption(tx, {
    workspaceId: ctx.workspaceId,
    mutatorName,
  });

  return new Proxy(storageTx, {
    get(target, prop: string | symbol, receiver) {
      if (prop === 'mutate') {
        return wrapMutateWithACL(target.mutate, ctx, storageTx, vespaJobs, sideEffectJobs);
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return value.bind(target);
      }

      return value;
    },
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

            // 5. Execute original mutation (if ACL passes)
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

/**
 * Re-encrypt configured plaintext fields to server-encrypted format (ENC:v1|srv-...|...)
 * before writing to the database.
 *
 * When encryptedFieldsConfig is empty, returns args unchanged (no-op).
 * Only string fields listed in the config for this table are re-encrypted.
 */
async function reEncryptForStorage(
  tableName: string,
  args: unknown,
  workspaceId: string,
): Promise<unknown> {
  const tableConfig = encryptedFieldsConfig[tableName];
  if (!tableConfig || tableConfig.fields.size === 0) {
    return args;
  }

  if (!args || typeof args !== 'object') {
    return args;
  }

  const clonedArgs = { ...args } as Record<string, unknown>;
  if (typeof clonedArgs.workspaceId === 'string' && clonedArgs.workspaceId !== workspaceId) {
    throw new Error(`Encrypted write on table ${tableName} has workspaceId outside authenticated workspace`);
  }

  const items: Array<{ field: string; value: string; workspaceId: string; entityType: string }> = [];
  for (const field of tableConfig.fields) {
    const value = clonedArgs[field];
    if (typeof value === 'string' && !value.startsWith('ENC:')) {
      items.push({ field, value, workspaceId, entityType: 'WORKSPACE' });
    }
  }

  const encryptedValues = await batchEncryptServerValues(
    items.map(({ value, workspaceId: itemWorkspaceId, entityType }) => ({
      value,
      entityId: itemWorkspaceId,
      entityType,
    })),
  );

  for (const [index, item] of items.entries()) {
    clonedArgs[item.field] = encryptedValues[index];
    }

  return clonedArgs;
}
