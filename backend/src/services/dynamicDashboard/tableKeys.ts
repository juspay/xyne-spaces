export function tableKey(schemaName: string, tableName: string): string {
  return `${schemaName}.${tableName}`;
}

export function columnKey(schemaName: string, tableName: string, columnName: string): string {
  return `${tableKey(schemaName, tableName)}.${columnName}`;
}

export function resolveTableRef<T extends { schemaName: string; tableName: string }>(
  tables: ReadonlyArray<T>,
  model: string,
  schema?: string,
): T | undefined {
  const direct = tables.find(
    (t) => t.tableName === model && (schema === undefined || t.schemaName === schema),
  );
  if (direct) return direct;
  const qualified = tables.find((t) => tableKey(t.schemaName, t.tableName) === model);
  if (qualified) return qualified;
  if (schema !== undefined && model.startsWith(`${schema}.`)) {
    const bare = model.slice(schema.length + 1);
    return tables.find((t) => t.tableName === bare && t.schemaName === schema);
  }
  return undefined;
}
