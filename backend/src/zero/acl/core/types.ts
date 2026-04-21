import { schema } from '@xyne/shared';
import { Schema } from '@xyne/shared';

export type QueryContext = {
  userID: string;
  workspaceId: string;
  role: string;
  orgRole: string;
  memberId: string;
};

export type TableName = keyof typeof schema.tables;

export type TableSchema<TTable extends TableName> = Schema['tables'][TTable];

export class MutationACLError extends Error {
  constructor(
    message: string,
    public readonly tableName: string,
  ) {
    super(message);
    this.name = 'MutationACLError';
    this.tableName = tableName
  }
}