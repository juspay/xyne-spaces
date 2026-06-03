
export interface TableMetadata {
  schemaName: string;
  tableName: string;
  columns: ReadonlyArray<{ columnName: string; dataTypeCanonical: string }>;
}

export interface JoinedTableMetadata extends TableMetadata {
  alias: string;
}

export interface CompiledQuery {
  sql: string;
  params: ReadonlyArray<unknown>;
}

export class QueryCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryCompileError';
  }
}
