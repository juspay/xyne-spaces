import { schema } from '../zero/schema';

export const zeroSyncedTableNames = (): ReadonlySet<string> =>
  new Set(Object.values(schema.tables).map(table => table.name));
