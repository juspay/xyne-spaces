import { encryptedFieldsConfig } from './encrypted-fields.js';
import { encryptField, decryptField, isEncryptedField } from '../crypto/field-decrypt.js';
import { Event } from '../logger/events.js';
import { getCryptoLogger } from '../crypto/crypto-logger.js';

export type Condition =
  | { type: 'simple'; left: { name: string }; op: string; right: unknown }
  | { type: 'and'; conditions: readonly Condition[] }
  | { type: 'or'; conditions: readonly Condition[] }
  | { type: 'correlatedSubquery'; [key: string]: unknown };

export interface QueryAST {
  table?: string;
  where?: Condition;
}

export class EncryptedFieldQueryError extends Error {
  public readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'EncryptedFieldQueryError';
  }
}

export function validateQueryWhereClause(query: unknown): void {
  const queryWithAst = query as { ast?: QueryAST };

  if (!queryWithAst.ast) {
    return;
  }

  const table = queryWithAst.ast.table;
  const where = queryWithAst.ast.where;

  if (!table) {
    return;
  }

  const tableConfig = encryptedFieldsConfig[table];

  if (!tableConfig || tableConfig.fields.size === 0) {
    return;
  }

  const encryptedFields = tableConfig.fields;

  function walkCondition(condition: Condition): void {
    if (!condition || typeof condition !== 'object') {
      return;
    }

    switch (condition.type) {
      case 'simple': {
        const fieldName = condition.left?.name;
        if (fieldName && encryptedFields.has(fieldName)) {
          throw new EncryptedFieldQueryError(
            `Zero query on table "${table}" uses encrypted field "${fieldName}" in WHERE clause. Encrypted fields cannot be used for filtering.`
          );
        }
        break;
      }
      case 'and':
      case 'or': {
        if (Array.isArray(condition.conditions)) {
          for (const subCondition of condition.conditions) {
            walkCondition(subCondition);
          }
        }
        break;
      }
      case 'correlatedSubquery':
        break;
      default:
        break;
    }
  }

  if (where) {
    walkCondition(where);
  }
}

async function decryptResult(result: unknown, key: CryptoKey): Promise<unknown> {
  const logger = getCryptoLogger();

  if (typeof result === 'string') {
    if (isEncryptedField(result)) {
      try {
        return await decryptField(result, key);
      } catch (error) {
        logger.error(Event.ENCRYPTION_FIELD_DECRYPT, {
          message: '[encryptionlog] Failed to decrypt field in result',
          error: error instanceof Error ? error.message : String(error),
        });
        return result;
      }
    }
    return result;
  }

  if (Array.isArray(result)) {
    const decryptedArray: unknown[] = [];
    for (const item of result) {
      try {
        decryptedArray.push(await decryptResult(item, key));
      } catch (error) {
        logger.error(Event.ENCRYPTION_FIELD_DECRYPT, {
          message: '[encryptionlog] Failed to decrypt array item',
          error: error instanceof Error ? error.message : String(error),
        });
        decryptedArray.push(item);
      }
    }
    return decryptedArray;
  }

  if (result && typeof result === 'object') {
    const decrypted: Record<string, unknown> = {};
    for (const [keyName, value] of Object.entries(result)) {
      try {
        decrypted[keyName] = await decryptResult(value, key);
      } catch (error) {
        logger.error(Event.ENCRYPTION_FIELD_DECRYPT, {
          message: `[encryptionlog] Failed to decrypt field: ${keyName}`,
          field: keyName,
          error: error instanceof Error ? error.message : String(error),
        });
        decrypted[keyName] = value;
      }
    }
    return decrypted;
  }

  return result;
}

async function encryptMutationArgs(
  tableName: string,
  args: unknown,
  key: CryptoKey,
): Promise<unknown> {
  const logger = getCryptoLogger();

  const tableConfig = encryptedFieldsConfig[tableName];

  if (!tableConfig || tableConfig.fields.size === 0) {
    return args;
  }

  if (!args || typeof args !== 'object') {
    return args;
  }

  const clonedArgs = { ...args } as Record<string, unknown>;

  for (const field of tableConfig.fields) {
    const value = clonedArgs[field];
    if (typeof value === 'string' && !value.startsWith('ENC:')) {
      try {
        clonedArgs[field] = await encryptField(value, key, field, tableName);
      } catch (error) {
        logger.error(Event.ENCRYPTION_FIELD_ENCRYPT, {
          message: `[encryptionlog] Failed to encrypt field: ${field}`,
          field,
          table: tableName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return clonedArgs;
}

export function wrapClientTransaction<T extends { run: Function; mutate: Record<string, unknown> }>(
  tx: T,
  encryptionKey: CryptoKey,
): T {
  return new Proxy(tx, {
    get(target, prop: string | symbol) {
      if (prop === 'run') {
        return async function (...args: unknown[]) {
          validateQueryWhereClause(args[0]);

          const result = await target.run.apply(target, args);

          try {
            return await decryptResult(result, encryptionKey);
          } catch (error) {
            const logger = getCryptoLogger();
            logger.error(Event.ENCRYPTION_FIELD_DECRYPT, {
              message: '[encryptionlog] Failed to decrypt run result',
              error: error instanceof Error ? error.message : String(error),
            });
            return result;
          }
        };
      }

      if (prop === 'mutate') {
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
                    const encryptedArgs = await encryptMutationArgs(
                      tableName,
                      args,
                      encryptionKey,
                    );
                    return await (originalOp as Function).call(this, encryptedArgs);
                  }

                  return await (originalOp as Function).call(this, args);
                };
              },
            });
          },
        });
      }

      return Reflect.get(target, prop);
    },
  }) as T;
}
