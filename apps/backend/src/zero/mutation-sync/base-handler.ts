import type { Transaction } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import type { QueryContext } from '../acl/core/types';

export class BaseMutationSyncHandler {
  protected ctx: QueryContext;

  constructor(ctx: QueryContext) {
    this.ctx = ctx;
  }

  async onInsert(
    _args: unknown,
    _tx: Transaction<Schema>,
    _previousValue?: unknown
  ): Promise<void> {
    return Promise.resolve();
  }

  async onUpdate(
    _args: unknown,
    _tx: Transaction<Schema>,
    _previousValue?: unknown
  ): Promise<void> {
    return Promise.resolve();
  }

  async onDelete(
    _args: unknown,
    _tx: Transaction<Schema>,
    _previousValue?: unknown
  ): Promise<void> {
    return Promise.resolve();
  }

  async onUpsert(
    _args: unknown,
    _tx: Transaction<Schema>,
    _previousValue?: unknown
  ): Promise<void> {
    return Promise.resolve();
  }
}
