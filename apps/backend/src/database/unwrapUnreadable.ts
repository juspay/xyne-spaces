import { UnreadableString, reveal } from '@xyne/shared';
import { unreadableColumnsOf } from '@/zero/unreadableColumns';

// The unwrap point for Prisma writes, as unreadableTransaction's unwrapForWrite is for Zero writes.
// It runs at the call: Prisma copies query args into plain objects, so an UnreadableString never reaches an extension.

/** `value` (composed, already encrypted) as written to `table.column`, which must be an unreadable column. */
export function unwrapForColumn(table: string, column: string, value: UnreadableString): string {
  if (!unreadableColumnsOf(table).includes(column)) {
    throw new Error(`${table}.${column} is not an unreadable column; it cannot be written from an UnreadableString`);
  }
  return reveal(value);
}
