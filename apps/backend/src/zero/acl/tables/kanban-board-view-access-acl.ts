import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema, type QueryContext } from '../core/types';
import { zql } from '../../queries';

export class KanbanBoardViewAccessACL extends BaseACL<'kanban_board_view_access'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'kanban_board_view_access');
  }

  async canInsert(
    args: InsertValue<TableSchema<'kanban_board_view_access'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    // The sharer must be the view owner
    const view = await tx.run(
      zql.saved_user_configurations.where('id', args.viewId).one(),
    );
    if (!view) {
      throw new MutationACLError(
        'View access insert failed: view not found',
        'kanban_board_view_access',
      );
    }
    if (view.userId !== this.ctx.userID) {
      throw new MutationACLError(
        'View access insert failed: only the view owner can share it',
        'kanban_board_view_access',
      );
    }
  }

  async canUpdate(
    _args: UpdateValue<TableSchema<'kanban_board_view_access'>>,
    _tx: Transaction<Schema>,
  ): Promise<void> {
    throw new MutationACLError(
      'View access rows are immutable — revoke and re-grant instead',
      'kanban_board_view_access',
    );
  }

  async canDelete(
    args: DeleteID<TableSchema<'kanban_board_view_access'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const access = await tx.run(zql.kanban_board_view_access.where('id', args.id).one());
    if (!access) {
      throw new MutationACLError(
        'View access delete failed: access row not found',
        'kanban_board_view_access',
      );
    }
    // The view owner or the granted user can remove the grant
    const view = await tx.run(
      zql.saved_user_configurations.where('id', access.viewId).one(),
    );
    if (!view) {
      throw new MutationACLError(
        'View access delete failed: view not found',
        'kanban_board_view_access',
      );
    }
    if (view.userId !== this.ctx.userID && access.userId !== this.ctx.userID) {
      throw new MutationACLError(
        'View access delete failed: only the view owner or the granted user can revoke access',
        'kanban_board_view_access',
      );
    }
  }
}
