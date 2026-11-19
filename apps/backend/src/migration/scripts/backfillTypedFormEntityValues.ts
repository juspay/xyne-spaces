/**
 * One-shot backfill of the typed value columns on form_entity_values (textValue, textHash,
 * numberValue, dateValue, boolValue, plainValue) and of form_entity_value_items, from
 * actualFieldValue.
 *
 * Why: rows written before the typed columns existed have only actualFieldValue. Every write
 * now fills both, so this only has to reach the older rows, once per environment, before
 * readers stop falling back to actualFieldValue.
 *
 * Old rows hold mixed shapes ("42" for a number, a lone user id for USER, an option id
 * instead of its value for select fields); the shared conversion parses those, and option
 * ids are mapped to their option value here. Values that still can't be converted are
 * counted per field and logged rather than dropped silently, and left as they are.
 *
 * Only rows with no typed value and no items are touched, and each keeps its original
 * updatedAt, since several readers pick the newest row by it. Re-running is safe.
 *
 *   pnpm --filter backend exec dotenv -e .env.local -- tsx src/migration/scripts/backfillTypedFormEntityValues.ts [--dry-run] [--batch-size=500]
 */
import { Prisma } from '@prisma/client';
import { FormFieldType, parseFieldOptions, toTypedFormEntityValue } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { resolveFieldDefinitionsByIds, type FieldDefinition } from '@/utils/fieldDefinition';
import { updateFormEntityValue } from '@/database/repositories/formEntityValueRepository';

const LOG_PREFIX = '[BackfillTypedFormEntityValues]';
const OPTION_TYPES = new Set<string>([FormFieldType.SINGLE_SELECT, FormFieldType.MULTI_SELECT]);

// Select fields used to store option ids; the typed columns hold option values.
function optionIdsToValues(definition: FieldDefinition, value: Prisma.JsonValue): Prisma.JsonValue {
  if (!OPTION_TYPES.has(definition.fieldType)) return value;
  const valueById = new Map(parseFieldOptions(definition.fieldEnum).map(option => [option.id, option.value]));
  const map = (item: Prisma.JsonValue) => (typeof item === 'string' ? valueById.get(item) ?? item : item);
  return Array.isArray(value) ? value.map(map) : map(value);
}

function isEmptyValue(value: Prisma.JsonValue | null): boolean {
  return (
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  );
}

const run = async (): Promise<void> => {
  const dryRun = process.argv.includes('--dry-run');
  const batchArg = process.argv.find(arg => arg.startsWith('--batch-size='));
  const batchSize = batchArg ? Math.max(1, Number(batchArg.split('=')[1]) || 500) : 500;

  let cursor: string | undefined;
  let scanned = 0;
  let written = 0;
  let empty = 0;
  let unknownField = 0;
  const unconvertible = new Map<string, { fieldName: string; fieldType: string; count: number; sample: unknown }>();

  for (;;) {
    const rows = await db.formEntityValues.findMany({
      where: {
        textValue: null,
        textHash: null,
        numberValue: null,
        dateValue: null,
        boolValue: null,
        plainValue: null,
        actualFieldValue: { not: Prisma.DbNull },
        items: { none: {} },
        ...(cursor && { id: { gt: cursor } }),
      },
      select: { id: true, workspaceId: true, fieldId: true, updatedAt: true, actualFieldValue: true },
      orderBy: { id: 'asc' },
      take: batchSize,
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    scanned += rows.length;

    const definitions = await resolveFieldDefinitionsByIds(db, rows.map(row => row.fieldId));

    for (const row of rows) {
      if (isEmptyValue(row.actualFieldValue)) {
        empty += 1;
        continue;
      }
      const definition = definitions.get(row.fieldId);
      if (!definition) {
        unknownField += 1;
        continue;
      }

      const value = optionIdsToValues(definition, row.actualFieldValue as Prisma.JsonValue);
      const typed = toTypedFormEntityValue(definition.fieldType, value);
      const hasTypedValue = Object.values(typed.columns).some(column => column !== null) || typed.items.length > 0;
      if (!hasTypedValue) {
        const entry = unconvertible.get(row.fieldId) ?? {
          fieldName: definition.fieldName,
          fieldType: definition.fieldType,
          count: 0,
          sample: row.actualFieldValue,
        };
        entry.count += 1;
        unconvertible.set(row.fieldId, entry);
        continue;
      }

      written += 1;
      if (dryRun) continue;
      await updateFormEntityValue(db, row.id, {
        fieldType: definition.fieldType,
        value,
        updatedAt: row.updatedAt,
      });
    }

    logger.info(`${LOG_PREFIX} scanned ${scanned}, ${dryRun ? 'would write' : 'wrote'} ${written}`);
  }

  logger.info(`${LOG_PREFIX} done${dryRun ? ' (dry run)' : ''}`, {
    scanned,
    written,
    emptyValues: empty,
    unknownField,
    unconvertibleFields: unconvertible.size,
  });
  for (const [fieldId, entry] of unconvertible) {
    logger.warn(`${LOG_PREFIX} values that don't fit their field type were left as they are`, {
      fieldId,
      ...entry,
    });
  }
};

run()
  .catch(error => {
    logger.error(`${LOG_PREFIX} Run failed`, error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
