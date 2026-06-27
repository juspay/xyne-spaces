import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared'
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class AppsACL extends BaseACL<'apps'> {

  async canInsert(_args: InsertValue<TableSchema<'apps'>>, _tx: Transaction<Schema>): Promise<void> {
    return;
  }

  async canUpdate(args: UpdateValue<TableSchema<'apps'>>, tx: Transaction<Schema>): Promise<void> {
    const app = await tx.run(zql.apps.where('id', args.id).one());
    if (!app) {
      throw new MutationACLError('App update failed: app does not exist', 'apps');
    }

    // Only the creator may edit the app template (commands/permissions/webhook/description).
    if (app.createdBy === this.ctx.userID) {
      return;
    }

    throw new MutationACLError('App update failed: only the app creator can modify this app', 'apps');
  }

  async canDelete(_args: DeleteID<TableSchema<'apps'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('App delete failed: apps cannot be deleted', 'apps');
  }

  async canUpsert(args: UpsertValue<TableSchema<'apps'>>, tx: Transaction<Schema>): Promise<void> {
    const app = await tx.run(zql.apps.where('id', args.id).one());
    if (!app) {
      throw new MutationACLError('App upsert failed: app does not exist for update', 'apps');
    }

    // Only the creator may edit the app template.
    if (app.createdBy === this.ctx.userID) {
      return;
    }

    throw new MutationACLError('App upsert failed: only the app creator can modify this app', 'apps');
  }
}
