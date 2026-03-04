import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';

export class SurfaceLinksACL extends BaseACL<'surface_links'> {
  async canInsert(args: InsertValue<TableSchema<'surface_links'>>, _tx: Transaction<Schema>): Promise<void> {
    // Inserts are allowed — they originate from the surfaceNudges.act mutator
    // which validates nudge existence and target info before inserting.
    if (!args.createdBy || args.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Surface link insert failed: createdBy must match current user', 'surface_links');
    }
  }

  async canUpdate(_args: UpdateValue<TableSchema<'surface_links'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Surface link update failed: links are system-managed', 'surface_links');
  }

  async canDelete(_args: DeleteID<TableSchema<'surface_links'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Surface link delete failed: links are system-managed', 'surface_links');
  }
}
