import { Prisma } from '@prisma/client';
import { encryptedFieldsConfig } from '@xyne/shared';
import { config } from '@/config/env';
import { getRawPrismaClient } from '@/database/raw-prisma';
import { batchDecryptServerValues, batchEncryptServerValues } from '@/services/internal/encryption-client';

const PRISMA_MODEL_TABLE_NAMES: Record<string, string> = {
  Message: 'messages',
  Conversation: 'conversations',
  Ticket: 'tickets',
  Email: 'emails',
  EmailDraft: 'email_drafts',
  DraftMessage: 'draft_messages',
  DelayedMessage: 'delayed_messages',
  ScheduledMessage: 'scheduled_messages',
};

function modelToTableName(model: string): string {
  return PRISMA_MODEL_TABLE_NAMES[model] ?? model
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}

function modelToDelegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/**
 * Validates that a WHERE clause does not contain encrypted fields.
 * Throws an error if any encrypted field is found in the where object.
 */
function validateWhereClause(tableName: string, where: unknown): void {
  const tableConfig = encryptedFieldsConfig[tableName];

  if (!tableConfig || tableConfig.fields.size === 0) {
    return;
  }

  const encryptedFields = tableConfig.fields;
  const prismaModifierKeys = new Set(['AND', 'OR', 'NOT', 'is', 'isNot', 'every', 'some', 'none']);

  function walkWhere(obj: unknown): void {
    if (!obj || typeof obj !== 'object') {
      return;
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        walkWhere(item);
      }
      return;
    }

    for (const [key, value] of Object.entries(obj)) {
      if (prismaModifierKeys.has(key)) {
        walkWhere(value);
        continue;
      }

      if (encryptedFields.has(key)) {
        throw new Error(
          `Query on table "${tableName}" uses encrypted field "${key}" in WHERE clause. Encrypted fields cannot be used for filtering.`
        );
      }

      if (value && typeof value === 'object') {
        walkWhere(value);
      }
    }
  }

  walkWhere(where);
}

/**
 * Decrypts configured fields on result rows.
 * Only fields that start with 'ENC:' are decrypted.
 * Non-configured models and plain values pass through unchanged.
 *
 * When encryptedFieldsConfig is empty (Stage 6), this is a complete no-op.
 */
async function decryptConfiguredFields<T>(model: string, result: T): Promise<T> {
  const tableName = modelToTableName(model);
  const tableConfig = encryptedFieldsConfig[tableName];

  // No configured fields for this table — pass through
  if (!tableConfig || tableConfig.fields.size === 0) {
    return result;
  }

  const rows = Array.isArray(result) ? result : [result];
  const refs: Array<{ row: Record<string, unknown>; field: string; value: string }> = [];

  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      continue;
    }

    for (const field of tableConfig.fields) {
      const value = (row as Record<string, unknown>)[field];
      if (typeof value === 'string' && value.startsWith('ENC:')) {
        refs.push({ row: row as Record<string, unknown>, field, value });
      }
    }
  }

  const decryptedValues = await batchDecryptServerValues(refs.map((ref) => ref.value));
  for (const [index, ref] of refs.entries()) {
    ref.row[ref.field] = decryptedValues[index];
  }

  return result;
}

function hasPlaintextFieldToEncrypt(
  record: Record<string, unknown>,
  fields: Set<string>,
): boolean {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value.length > 0 && !value.startsWith('ENC:')) {
      return true;
    }
  }
  return false;
}

function getPayloadWorkspaceId(tableName: string, payload: Record<string, unknown>): string {
  const workspaceId = payload.workspaceId;
  if (typeof workspaceId === 'string' && workspaceId.length > 0) {
    return workspaceId;
  }

  throw new Error(`Encrypted write on table ${tableName} requires payload.workspaceId`);
}

async function resolveWorkspaceIdFromPrismaWhere(
  model: string,
  tableName: string,
  where: unknown,
): Promise<string> {
  if (!where || typeof where !== 'object') {
    throw new Error(`Encrypted update on table ${tableName} requires a WHERE clause to resolve workspaceId`);
  }

  const prisma = getRawPrismaClient() as unknown as Record<string, { findMany: (args: unknown) => Promise<Array<{ workspaceId?: string | null }>> }>;
  const delegate = prisma[modelToDelegateName(model)];
  if (!delegate?.findMany) {
    throw new Error(`No Prisma delegate available for encrypted table ${tableName}`);
  }

  const rows = await delegate.findMany({
    where,
    select: { workspaceId: true },
  });

  if (rows.length === 0) {
    throw new Error(`Encrypted update on table ${tableName} matched zero rows while resolving workspaceId`);
  }

  const workspaceIds = new Set<string>();
  for (const row of rows) {
    if (typeof row.workspaceId !== 'string' || row.workspaceId.length === 0) {
      throw new Error(`Encrypted update on table ${tableName} matched a row with missing workspaceId`);
    }
    workspaceIds.add(row.workspaceId);
  }

  if (workspaceIds.size > 1) {
    throw new Error(`Encrypted update on table ${tableName} spans multiple workspaces; payload.workspaceId is required`);
  }

  return [...workspaceIds][0]!;
}

async function resolveWorkspaceIdForEncryptedWrite(
  model: string,
  tableName: string,
  payload: Record<string, unknown>,
  operationKind: 'create' | 'update',
  where?: unknown,
): Promise<string> {
  if (typeof payload.workspaceId === 'string' && payload.workspaceId.length > 0) {
    return payload.workspaceId;
  }

  if (operationKind === 'create') {
    return getPayloadWorkspaceId(tableName, payload);
  }

  return resolveWorkspaceIdFromPrismaWhere(model, tableName, where);
}

/**
 * Encrypt a single record's fields to server-encrypted format.
 */
async function encryptRecordFields(
  model: string,
  tableName: string,
  record: Record<string, unknown>,
  fields: Set<string>,
  operationKind: 'create' | 'update',
  where?: unknown,
): Promise<Record<string, unknown>> {
  if (!hasPlaintextFieldToEncrypt(record, fields)) {
    return record;
  }

  const workspaceId = await resolveWorkspaceIdForEncryptedWrite(model, tableName, record, operationKind, where);
  const encrypted = { ...record };
  const items: Array<{ field: string; value: string; workspaceId: string }> = [];

  for (const field of fields) {
    const value = encrypted[field];
    if (typeof value === 'string' && value.length > 0 && !value.startsWith('ENC:')) {
      items.push({ field, value, workspaceId });
    }
  }

  const encryptedValues = await batchEncryptServerValues(
    items.map(({ value, workspaceId: itemWorkspaceId }) => ({ value, workspaceId: itemWorkspaceId })),
  );

  for (const [index, item] of items.entries()) {
    encrypted[item.field] = encryptedValues[index];
  }

  return encrypted;
}

/**
 * Encrypts plaintext fields to server-encrypted format before DB write.
 * Only processes fields configured in encryptedFieldsConfig.
 */
async function encryptWriteData<T>(model: string, operation: string, args: T): Promise<T> {
  const tableName = modelToTableName(model);
  const tableConfig = encryptedFieldsConfig[tableName];

  if (!tableConfig || tableConfig.fields.size === 0 || !args || typeof args !== 'object') {
    return args;
  }

  const argsRecord = args as Record<string, unknown>;
  const cloned = { ...argsRecord };
  const dataOperationKind: 'create' | 'update' =
    operation === 'create' || operation === 'createMany' ? 'create' : 'update';

  // Handle 'data' property (create, update, updateMany)
  if (cloned.data && typeof cloned.data === 'object') {
    if (Array.isArray(cloned.data)) {
      // createMany: data is an array
      cloned.data = await Promise.all(cloned.data.map((item) =>
        typeof item === 'object' && item !== null
          ? encryptRecordFields(
            model,
            tableName,
            item as Record<string, unknown>,
            tableConfig.fields,
            dataOperationKind,
            argsRecord.where,
          )
          : item,
      ));
    } else {
      // create, update: data is a single object
      cloned.data = await encryptRecordFields(
        model,
        tableName,
        cloned.data as Record<string, unknown>,
        tableConfig.fields,
        dataOperationKind,
        argsRecord.where,
      );
    }
  }

  // Handle upsert: has 'create' and 'update' instead of 'data'
  if (cloned.create && typeof cloned.create === 'object') {
    cloned.create = await encryptRecordFields(
      model,
      tableName,
      cloned.create as Record<string, unknown>,
      tableConfig.fields,
      'create',
      argsRecord.where,
    );
  }
  if (cloned.update && typeof cloned.update === 'object') {
    cloned.update = await encryptRecordFields(
      model,
      tableName,
      cloned.update as Record<string, unknown>,
      tableConfig.fields,
      'update',
      argsRecord.where,
    );
  }

  return cloned as T;
}

/**
 * Prisma client extension that transparently handles encrypted fields:
 * - Encrypts plaintext fields on writes (create, update, upsert)
 * - Decrypts server-encrypted fields on reads (findMany, findFirst, etc.)
 *
 * When encryptedFieldsConfig is empty, this is a complete no-op pass-through.
 */
export const encryptionExtension = Prisma.defineExtension({
  name: 'prisma-field-encryption',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const tableName = modelToTableName(model);
        const argsRecord = args as Record<string, unknown>;

        // Validate WHERE clause to prevent filtering on encrypted fields (reads and writes)
        if (argsRecord.where) {
          validateWhereClause(tableName, argsRecord.where);
        }

        // Encrypt writes
        if (
          config.enc.enableDbEncryption && ["create", "update", "upsert", "createMany", "updateMany"].includes(operation)
        ) {
          args = await encryptWriteData(model, operation, args);
        }

        const result = await query(args);

        // Decrypt reads
        if (
          config.enc.enableDbEncryption && ["create", "createMany", "findMany", "findFirst", "findUnique", "findFirstOrThrow", "findUniqueOrThrow"].includes(operation)
        ) {
          return await decryptConfiguredFields(model, result);
        }

        return result;
      },
    },
  },
});
