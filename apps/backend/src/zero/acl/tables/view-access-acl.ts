import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema, ViewAccessEntityType } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema, type QueryContext } from '../core/types';
import { zql } from '../../queries';

export class ViewAccessACL extends BaseACL<'view_access'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'view_access');
  }

  async canInsert(
    args: InsertValue<TableSchema<'view_access'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    // The sharer must be the view owner
    const view = await tx.run(
      zql.saved_user_configurations.where('id', args.viewId).one(),
    );
    if (!view) {
      throw new MutationACLError(
        'View access insert failed: view not found',
        'view_access',
      );
    }
    if (view.userId !== this.ctx.userID) {
      throw new MutationACLError(
        'View access insert failed: only the view owner can share it',
        'view_access',
      );
    }
  }

  async canUpdate(
    _args: UpdateValue<TableSchema<'view_access'>>,
    _tx: Transaction<Schema>,
  ): Promise<void> {
    throw new MutationACLError(
      'View access rows are immutable — revoke and re-grant instead',
      'view_access',
    );
  }

  async canDelete(
    args: DeleteID<TableSchema<'view_access'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const access = await tx.run(zql.view_access.where('id', args.id).one());
    if (!access) {
      throw new MutationACLError(
        'View access delete failed: access row not found',
        'view_access',
      );
    }
    // The view owner or the granted user can remove the grant
    const view = await tx.run(
      zql.saved_user_configurations.where('id', access.viewId).one(),
    );
    if (!view) {
      throw new MutationACLError(
        'View access delete failed: view not found',
        'view_access',
      );
    }
    const isGrantTarget =
      access.entityType === ViewAccessEntityType.USER && access.entityId === this.ctx.userID;
    if (view.userId !== this.ctx.userID && !isGrantTarget) {
      throw new MutationACLError(
        'View access delete failed: only the view owner or the granted user can revoke access',
        'view_access',
      );
    }
  }
}
