import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { assertGuestWriteBlocked } from '../core/guest-access';

export class ResourcesACL extends BaseACL<'resources'> {
  async canInsert(
    _args: InsertValue<TableSchema<'resources'>>,
    _tx: Transaction<Schema>,
  ): Promise<void> {
    assertGuestWriteBlocked(this.ctx, 'resources', 'insert', 'Resource');
    throw new MutationACLError(
      'Resource insert failed: resources are created through backend services only',
      'resources',
    );
  }

  async canUpdate(
    _args: UpdateValue<TableSchema<'resources'>>,
    _tx: Transaction<Schema>,
  ): Promise<void> {
    assertGuestWriteBlocked(this.ctx, 'resources', 'update', 'Resource');
    throw new MutationACLError(
      'Resource update failed: resources can only be updated through backend services',
      'resources',
    );
  }

  async canDelete(
    _args: DeleteID<TableSchema<'resources'>>,
    _tx: Transaction<Schema>,
  ): Promise<void> {
    assertGuestWriteBlocked(this.ctx, 'resources', 'delete', 'Resource');
    throw new MutationACLError(
      'Resource delete failed: resources can only be deleted through backend services',
      'resources',
    );
  }
}
