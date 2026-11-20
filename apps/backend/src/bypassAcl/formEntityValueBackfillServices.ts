import { Prisma } from '@prisma/client';
import { FormFieldType, parseFieldOptions, toTypedFormEntityValue } from '@xyne/shared';
import { db } from '@/database/client';
import {
  countFormEntityValuesToBackfill,
  findFormEntityValuesToBackfill,
  updateFormEntityValue,
} from '@/database/repositories/formEntityValueRepository';
import { resolveFieldDefinitionsByIds, type FieldDefinition } from '@/utils/fieldDefinition';
import { logger } from '@/utils/logger';
import { asSystem } from './base';

const TAG = '[FormEntityValueBackfill]';
const TABLES: Array<'FormEntityValues' | 'FormEntityValueItems' | 'GlobalField' | 'FormFields'> = [
  'FormEntityValues',
  'FormEntityValueItems',
  'GlobalField',
  'FormFields',
];
const REASON = 'one-off backfill of the typed custom-field columns spans every workspace by design';
const OPTION_TYPES = new Set<string>([FormFieldType.SINGLE_SELECT, FormFieldType.MULTI_SELECT]);

export interface FormEntityValueBackfillOptions {
  batchSize: number;
  delayMs: number;
  maxBatches: number;
  dryRun: boolean;
  cursor: string | null;
}

type UnconvertibleField = { fieldId: string; fieldName: string; fieldType: string; count: number; sample: unknown };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

/**
 * Copies values written before the typed columns existed (actualFieldValue only) into the
 * typed columns and form_entity_value_items. Old rows hold mixed shapes ("42" for a number,
 * a lone user id for USER, an option id for select fields); the shared conversion parses
 * those and option ids are mapped to their option value. Values that still don't fit their
 * field type are reported per field and left as they are. Each row keeps its updatedAt,
 * since several readers pick the newest row by it.
 *
 * Runs as the system actor: `db` is the ACL-wrapped client, and a request context would
 * narrow this to the calling admin's workspace.
 */
export function runFormEntityValueBackfill(options: FormEntityValueBackfillOptions) {
  return asSystem(TABLES, REASON, async () => {
    const batches: Array<{ batch: number; scanned: number; written: number }> = [];
    const unconvertible = new Map<string, UnconvertibleField>();
    const totals = { scanned: 0, written: 0, emptyValues: 0, unknownField: 0, unconvertible: 0 };
    let cursor = options.cursor;
    let done = false;

    for (let batchNumber = 1; batchNumber <= options.maxBatches; batchNumber += 1) {
      const rows = await findFormEntityValuesToBackfill(db, { afterId: cursor, take: options.batchSize });
      if (rows.length === 0) {
        done = true;
        break;
      }
      cursor = rows[rows.length - 1].id;

      const definitions = await resolveFieldDefinitionsByIds(db, rows.map(row => row.fieldId));
      let written = 0;
      for (const row of rows) {
        if (isEmptyValue(row.actualFieldValue)) {
          totals.emptyValues += 1;
          continue;
        }
        const definition = definitions.get(row.fieldId);
        if (!definition) {
          totals.unknownField += 1;
          continue;
        }
        const value = optionIdsToValues(definition, row.actualFieldValue);
        const typed = toTypedFormEntityValue(definition.fieldType, value);
        if (Object.values(typed.columns).every(column => column === null) && typed.items.length === 0) {
          totals.unconvertible += 1;
          const entry = unconvertible.get(row.fieldId) ?? {
            fieldId: row.fieldId,
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
        if (!options.dryRun) {
          await updateFormEntityValue(db, row.id, {
            fieldType: definition.fieldType,
            value,
            updatedAt: row.updatedAt,
          });
        }
      }

      totals.scanned += rows.length;
      totals.written += written;
      batches.push({ batch: batchNumber, scanned: rows.length, written });
      logger.info(`${TAG} batch #${batchNumber}`, { scanned: rows.length, written, dryRun: options.dryRun });

      // A short page means the end of the table: no need to count what's left after every batch.
      if (rows.length < options.batchSize) {
        done = true;
        break;
      }
      if (options.delayMs > 0) await sleep(options.delayMs);
    }

    // Counted once per request: rows still to convert after this run's cursor.
    const remaining = done ? 0 : await countFormEntityValuesToBackfill(db, cursor);
    logger.info(`${TAG} finished`, { ...totals, done, remaining, nextCursor: cursor, dryRun: options.dryRun });
    return {
      success: true,
      dryRun: options.dryRun,
      done,
      remaining,
      nextCursor: cursor,
      totals,
      batches,
      unconvertibleFields: [...unconvertible.values()],
    };
  });
}

/**
 * `pending` counts rows still to look at. Rows the backfill can't convert (empty values, or
 * values that don't fit their field type) stay pending, so it never reaches zero while any exist.
 */
export function getFormEntityValueBackfillStatus() {
  return asSystem(TABLES, REASON, async () => {
    const pending = await countFormEntityValuesToBackfill(db);
    return { success: true, pending };
  });
}
