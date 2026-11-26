/**
 * The only Prisma access to form_entity_values and form_entity_value_items.
 *
 * Callers pass a field's type and its value; how the value is stored (typed columns, the
 * textHash of STRING values, one item row per MULTI_SELECT option or USER id) stays in this
 * file. Reads come back with `value` rebuilt by readFormEntityValue, so callers never touch
 * the storage columns. The local-rules/form-entity-values-through-repository lint rule keeps
 * other files from writing or reading these tables directly.
 */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import {
  type FormEntityValueRead,
  assertFormFieldType,
  type FormFieldType,
  formEntityValueItemId,
  readFormEntityValue,
  toTypedFormEntityValue,
} from '@xyne/shared';
import { formEntityValueTextHash } from '@/utils/formEntityValueHash';

type Client = Pick<Prisma.TransactionClient, 'formEntityValues' | 'formEntityValueItems'>;

export type FormEntityValueKey = {
  entityId: string;
  entityType: string;
  fieldId: string;
  contextId?: string | null;
  version?: number | null;
};

export type NewFormEntityValue = FormEntityValueKey & {
  id?: string;
  workspaceId: string;
  formId: string;
  fieldType: FormFieldType;
  value: unknown;
  createdAt?: Date;
  updatedAt?: Date;
};

/** A stored value: its row's scalar columns plus the value in the shape callers work with. */
export type FormEntityValueRecord = {
  id: string;
  workspaceId: string;
  entityId: string;
  entityType: string;
  formId: string;
  fieldId: string;
  contextId: string | null;
  version: number | null;
  createdAt: Date;
  updatedAt: Date;
  value: FormEntityValueRead;
};

const RECORD_SELECT = {
  id: true,
  workspaceId: true,
  entityId: true,
  entityType: true,
  formId: true,
  fieldId: true,
  contextId: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  textValue: true,
  numberValue: true,
  dateValue: true,
  boolValue: true,
  plainValue: true,
  items: { select: { item: true }, orderBy: { item: 'asc' } },
} satisfies Prisma.FormEntityValuesSelect;

type SelectedRow = Prisma.FormEntityValuesGetPayload<{ select: typeof RECORD_SELECT }>;

/** A row's scalar columns without its value. */
export type FormEntityValueKeyRecord = Omit<FormEntityValueRecord, 'value'>;

const KEY_SELECT = {
  id: true,
  workspaceId: true,
  entityId: true,
  entityType: true,
  formId: true,
  fieldId: true,
  contextId: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.FormEntityValuesSelect;

const toRecord = (row: SelectedRow): FormEntityValueRecord => ({
  id: row.id,
  workspaceId: row.workspaceId,
  entityId: row.entityId,
  entityType: row.entityType,
  formId: row.formId,
  fieldId: row.fieldId,
  contextId: row.contextId,
  version: row.version,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  value: readFormEntityValue(row),
});

function storedColumns(fieldType: FormFieldType, value: unknown, fieldId: string) {
  const typed = toTypedFormEntityValue(assertFormFieldType(fieldType, fieldId), value);
  const { dateValue, ...columns } = typed.columns;
  return {
    data: {
      // Nothing reads the old JSON column any more. Cleared, so the backfill can't copy a stale
      // value back over the typed columns.
      actualFieldValue: Prisma.DbNull,
      ...columns,
      dateValue: dateValue === null ? null : new Date(dateValue),
      textHash: typed.textHashInput === null ? null : formEntityValueTextHash(typed.textHashInput),
    },
    items: typed.items,
  };
}

type Operation = Prisma.PrismaPromise<unknown>;

// A value's row and its items change together. The array form of $transaction keeps every
// statement inside the tenant ACL extension (the callback form is reserved for bypassAcl/);
// inside a caller's transaction the statements simply run in order.
async function runTogether(client: Client, operations: Operation[]): Promise<unknown[]> {
  const withTransaction = client as Client & { $transaction?: (batch: Operation[]) => Promise<unknown[]> };
  if (typeof withTransaction.$transaction === 'function') {
    return withTransaction.$transaction([...operations]);
  }
  const results: unknown[] = [];
  for (const operation of operations) results.push(await operation);
  return results;
}

// Statements that make the value's items exactly `items`. Item ids are derived from the value
// and the item, so items that are already there are skipped rather than duplicated.
function itemOperations(
  client: Client,
  value: { id: string; workspaceId: string },
  items: readonly string[],
  isNewRow = false
): Operation[] {
  const wanted = [...new Set(items)];
  const operations: Operation[] = [];
  if (!isNewRow) {
    operations.push(
      client.formEntityValueItems.deleteMany({
        where: { valueId: value.id, ...(wanted.length > 0 && { item: { notIn: wanted } }) },
      })
    );
  }
  if (wanted.length > 0) {
    operations.push(
      client.formEntityValueItems.createMany({
        data: wanted.map((item) => ({
          id: formEntityValueItemId(value.id, item),
          workspaceId: value.workspaceId,
          valueId: value.id,
          item,
        })),
        skipDuplicates: true,
      })
    );
  }
  return operations;
}

const newRowData = (input: NewFormEntityValue, id: string) => {
  const stored = storedColumns(input.fieldType, input.value, input.fieldId);
  return {
    stored,
    data: {
      id,
      workspaceId: input.workspaceId,
      formId: input.formId,
      entityId: input.entityId,
      entityType: input.entityType,
      fieldId: input.fieldId,
      contextId: input.contextId ?? null,
      version: input.version ?? null,
      fieldValue: '',
      ...stored.data,
      ...(input.createdAt && { createdAt: input.createdAt }),
      ...(input.updatedAt && { updatedAt: input.updatedAt }),
    },
  };
};

export type WrittenFormEntityValue = { id: string; workspaceId: string };

/** Inserts one value. */
export async function createFormEntityValue(
  client: Client,
  input: NewFormEntityValue
): Promise<WrittenFormEntityValue> {
  const { stored, data } = newRowData(input, input.id ?? randomUUID());
  const row = { id: data.id, workspaceId: data.workspaceId };
  await runTogether(client, [
    client.formEntityValues.create({ data, select: { id: true } }),
    ...itemOperations(client, row, stored.items, true),
  ]);
  return row;
}

type NewRow = ReturnType<typeof newRowData>;

// The unique key only clashes when contextId and version are both set: Postgres treats NULLs
// as distinct.
const uniqueKeyOf = (row: Required<{ [K in keyof FormEntityValueKey]: NonNullable<FormEntityValueKey[K]> | null }>): string | null =>
  row.contextId !== null && row.version !== null
    ? JSON.stringify([row.entityId, row.entityType, row.fieldId, row.contextId, row.version])
    : null;

// The rows createMany's skipDuplicates would insert: those whose id or unique key is neither
// already stored nor used by an earlier row of the same batch.
async function rowsNotYetStored(client: Client, rows: NewRow[]): Promise<NewRow[]> {
  const keyed = rows.filter((row) => uniqueKeyOf(row.data) !== null);
  const existing = await client.formEntityValues.findMany({
    where: {
      OR: [
        { id: { in: rows.map((row) => row.data.id) } },
        ...(keyed.length > 0
          ? [
              {
                entityId: { in: [...new Set(keyed.map((row) => row.data.entityId))] },
                fieldId: { in: [...new Set(keyed.map((row) => row.data.fieldId))] },
                contextId: { not: null },
                version: { not: null },
              },
            ]
          : []),
      ],
    },
    select: { id: true, entityId: true, entityType: true, fieldId: true, contextId: true, version: true },
  });
  const takenIds = new Set(existing.map((row) => row.id));
  const takenKeys = new Set(
    existing.map(uniqueKeyOf).filter((key) => key !== null)
  );
  return rows.filter((row) => {
    const key = uniqueKeyOf(row.data);
    if (takenIds.has(row.data.id) || (key !== null && takenKeys.has(key))) return false;
    takenIds.add(row.data.id);
    if (key !== null) takenKeys.add(key);
    return true;
  });
}

/**
 * Inserts many values, each row together with its items. With skipDuplicates, rows that clash
 * on the id or unique key are left as they are (and keep their items).
 */
export async function createFormEntityValues(
  client: Client,
  inputs: readonly NewFormEntityValue[],
  options: { skipDuplicates?: boolean } = {}
): Promise<{ count: number }> {
  if (inputs.length === 0) return { count: 0 };
  const allRows = inputs.map((input) => newRowData(input, input.id ?? randomUUID()));
  const rows = options.skipDuplicates ? await rowsNotYetStored(client, allRows) : allRows;
  if (rows.length === 0) return { count: 0 };
  const [result] = (await runTogether(client, [
    client.formEntityValues.createMany({
      data: rows.map((row) => row.data),
      ...(options.skipDuplicates && { skipDuplicates: true }),
    }),
    ...rows.flatMap((row) => itemOperations(client, row.data, row.stored.items, true)),
  ])) as [{ count: number }];
  return result;
}

/**
 * Inserts the value, or replaces it if one already exists for the key. contextId and version
 * must be set: Prisma cannot address the unique key through null columns.
 */
export async function upsertFormEntityValue(
  client: Client,
  input: NewFormEntityValue & { contextId: string; version: number }
): Promise<WrittenFormEntityValue> {
  const existing = await client.formEntityValues.findUnique({
    where: {
      entityId_entityType_fieldId_contextId_version: {
        entityId: input.entityId,
        entityType: input.entityType,
        fieldId: input.fieldId,
        contextId: input.contextId,
        version: input.version,
      },
    },
    select: { id: true, workspaceId: true },
  });
  if (!existing) return createFormEntityValue(client, input);
  const stored = storedColumns(input.fieldType, input.value, input.fieldId);
  await runTogether(client, [
    client.formEntityValues.update({
      where: { id: existing.id },
      data: { ...stored.data, ...(input.updatedAt && { updatedAt: input.updatedAt }) },
      select: { id: true },
    }),
    ...itemOperations(client, existing, stored.items),
  ]);
  return existing;
}

/** Replaces the value of an existing row. */
export async function updateFormEntityValue(
  client: Client,
  id: string,
  input: { fieldType: FormFieldType; value: unknown; updatedAt?: Date }
): Promise<WrittenFormEntityValue> {
  const stored = storedColumns(input.fieldType, input.value, id);
  const row = await client.formEntityValues.findUniqueOrThrow({
    where: { id },
    select: { id: true, workspaceId: true },
  });
  await runTogether(client, [
    client.formEntityValues.update({
      where: { id },
      data: { ...stored.data, ...(input.updatedAt && { updatedAt: input.updatedAt }) },
      select: { id: true },
    }),
    ...itemOperations(client, row, stored.items),
  ]);
  return row;
}

/** Moves rows to another field, form or version without touching their values. */
export async function updateFormEntityValuePlacement(
  client: Client,
  where: Prisma.FormEntityValuesWhereInput,
  data: { fieldId?: string; formId?: string; version?: number; updatedAt?: Date }
): Promise<{ count: number }> {
  return client.formEntityValues.updateMany({ where, data });
}

/** Deletes rows and their items. */
export async function deleteFormEntityValues(
  client: Client,
  where: Prisma.FormEntityValuesWhereInput
): Promise<{ count: number }> {
  const rows = await client.formEntityValues.findMany({ where, select: { id: true } });
  if (rows.length === 0) return { count: 0 };
  const ids = rows.map((row) => row.id);
  const [, result] = (await runTogether(client, [
    client.formEntityValueItems.deleteMany({ where: { valueId: { in: ids } } }),
    client.formEntityValues.deleteMany({ where: { id: { in: ids } } }),
  ])) as [unknown, { count: number }];
  return result;
}

type FindArgs = {
  where: Prisma.FormEntityValuesWhereInput;
  orderBy?:
    | Prisma.FormEntityValuesOrderByWithRelationInput
    | Prisma.FormEntityValuesOrderByWithRelationInput[];
  take?: number;
  skip?: number;
  distinct?: Prisma.FormEntityValuesScalarFieldEnum[];
};

/** Reads values; each record carries `value` in the shape callers work with. */
export async function findFormEntityValues(
  client: Client,
  args: FindArgs
): Promise<FormEntityValueRecord[]> {
  const rows = await client.formEntityValues.findMany({ ...args, select: RECORD_SELECT });
  return rows.map(toRecord);
}

export async function findFormEntityValue(
  client: Client,
  args: FindArgs
): Promise<FormEntityValueRecord | null> {
  const row = await client.formEntityValues.findFirst({ ...args, select: RECORD_SELECT });
  return row ? toRecord(row) : null;
}

/** Counts rows; no values are read. */
export async function countFormEntityValues(
  client: Client,
  where: Prisma.FormEntityValuesWhereInput
): Promise<number> {
  return client.formEntityValues.count({ where });
}

/** Reads rows without their values, for callers that only need ids, entity ids or versions. */
export async function findFormEntityValueKeys(
  client: Client,
  args: FindArgs
): Promise<FormEntityValueKeyRecord[]> {
  return client.formEntityValues.findMany({ ...args, select: KEY_SELECT });
}

/**
 * Every distinct value stored in the matched rows with how many rows hold it, most common
 * first: STRING values grouped by their hash (which already folds case and spaces), the other
 * scalar columns as stored, and MULTI_SELECT/USER items one option each. Each of the three groupings reads at most `groupLimit` groups.
 */
export async function countFormEntityValuesByValue(
  client: Client,
  where: Prisma.FormEntityValuesWhereInput,
  groupLimit: number
): Promise<Array<{ value: string; count: number }>> {
  const [scalarGroups, textGroups, itemGroups] = await Promise.all([
    client.formEntityValues.groupBy({
      by: ['plainValue', 'numberValue', 'boolValue', 'dateValue'],
      where: { AND: [where, { textHash: null }] },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: groupLimit,
    }),
    client.formEntityValues.groupBy({
      by: ['textHash'],
      where: { AND: [where, { textHash: { not: null } }] },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: groupLimit,
    }),
    client.formEntityValueItems.groupBy({
      by: ['item'],
      where: { value: where },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: groupLimit,
    }),
  ]);

  const hashes = textGroups.flatMap((group) => (group.textHash ? [group.textHash] : []));
  const textByHash = new Map<string, string>();
  if (hashes.length > 0) {
    const samples = await client.formEntityValues.findMany({
      where: { AND: [where, { textHash: { in: hashes } }] },
      distinct: ['textHash'],
      select: { textHash: true, textValue: true },
    });
    for (const sample of samples) {
      if (sample.textHash && sample.textValue !== null)
        textByHash.set(sample.textHash, sample.textValue);
    }
  }

  const counts: Array<{ value: string; count: number }> = [];
  for (const group of scalarGroups) {
    const value = readFormEntityValue({ ...group, items: [] });
    if (value !== null && !Array.isArray(value))
      counts.push({ value: String(value), count: group._count.id });
  }
  for (const group of textGroups) {
    const value = group.textHash ? textByHash.get(group.textHash) : undefined;
    if (value !== undefined) counts.push({ value, count: group._count.id });
  }
  for (const group of itemGroups) {
    counts.push({ value: group.item, count: group._count.id });
  }
  return counts.sort((left, right) => right.count - left.count);
}

/**
 * Rows written before the typed columns existed: no typed value, no items, and a non-empty
 * actualFieldValue. Empty values ("", [], JSON null) have nothing to copy, so they are left out.
 */
const toBackfillWhere: Prisma.FormEntityValuesWhereInput = {
  textValue: null,
  textHash: null,
  numberValue: null,
  dateValue: null,
  boolValue: null,
  plainValue: null,
  actualFieldValue: { not: Prisma.DbNull },
  NOT: [
    { actualFieldValue: { equals: Prisma.JsonNull } },
    { actualFieldValue: { equals: '' } },
    { actualFieldValue: { equals: [] } },
  ],
  items: { none: {} },
};

/**
 * The next page of rows the typed-column backfill still has to convert, after `afterId`.
 * Rows it cannot convert stay in this set, so callers page by id rather than re-reading
 * from the start.
 */
export async function findFormEntityValuesToBackfill(
  client: Client,
  args: { afterId: string | null; take: number }
): Promise<
  Array<{
    id: string;
    workspaceId: string;
    fieldId: string;
    updatedAt: Date;
    actualFieldValue: Prisma.JsonValue;
  }>
> {
  return client.formEntityValues.findMany({
    where: { ...toBackfillWhere, ...(args.afterId ? { id: { gt: args.afterId } } : {}) },
    select: { id: true, workspaceId: true, fieldId: true, updatedAt: true, actualFieldValue: true },
    orderBy: { id: 'asc' },
    take: args.take,
  });
}

/** How many rows the typed-column backfill still has to look at, optionally after `afterId`. */
export async function countFormEntityValuesToBackfill(
  client: Client,
  afterId: string | null = null
): Promise<number> {
  return client.formEntityValues.count({
    where: { ...toBackfillWhere, ...(afterId ? { id: { gt: afterId } } : {}) },
  });
}
