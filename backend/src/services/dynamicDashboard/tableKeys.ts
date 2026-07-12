export function tableKey(schemaName: string, tableName: string): string {
  return `${schemaName}.${tableName}`;
}

export function columnKey(schemaName: string, tableName: string, columnName: string): string {
  return `${tableKey(schemaName, tableName)}.${columnName}`;
}
