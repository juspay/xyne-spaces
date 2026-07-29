import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import type { TableName, VespaQueueHandler } from './types';
import type { QueryContext } from '../../acl/core/types';

/**
 * Type helper for table schema
 */
type TableSchema<TTable extends TableName> = Schema['tables'][TTable];

/**
 * Base class for Vespa injection handlers.
 * 
 * By default, all methods return empty arrays (no jobs queued).
 * Table-specific handlers should extend this class and override
 * methods for operations that require Vespa indexing.
 * 
 * Unlike ACL (which throws errors to block operations), this layer
 * simply collects job configurations to be queued after successful mutations.
 */
export class BaseVespaHandler<TTable extends TableName> {
  protected ctx: QueryContext;
  protected tableName: string;

  constructor(ctx: QueryContext, tableName?: string) {
    this.ctx = ctx;
    this.tableName = tableName || 'unknown';
  }

  /**
   * Called after a successful insert operation.
   * Override to return VespaQueueHandler[] for tables that need indexing.
   */
  onInsert(_args: InsertValue<TableSchema<TTable>>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [];
  }

  /**
   * Called after a successful update operation.
   * Override to return VespaQueueHandler[] for tables that need indexing.
   */
  onUpdate(_args: UpdateValue<TableSchema<TTable>>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [];
  }

  /**
   * Called after a successful upsert operation.
   * Override to return VespaQueueHandler[] for tables that need indexing.
   */
  onUpsert(_args: UpsertValue<TableSchema<TTable>>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [];
  }

  /**
   * Called after a successful delete operation.
   * Override to return VespaQueueHandler[] for tables that need indexing.
   */
  onDelete(_args: DeleteID<TableSchema<TTable>>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [];
  }
}
