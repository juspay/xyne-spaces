import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';

export class ResourcesACL extends BaseACL<'resources'> {
  async canInsert(
    _args: InsertValue<TableSchema<'resources'>>,
    _tx: Transaction<Schema>,
  ): Promise<void> {
    throw new MutationACLError(
      'Resource insert failed: resources are created through backend services only',
      'resources',
    );
  }

  async canUpdate(
    _args: UpdateValue<TableSchema<'resources'>>,
    _tx: Transaction<Schema>,
  ): Promise<void> {
    throw new MutationACLError(
      'Resource update failed: resources can only be updated through backend services',
      'resources',
    );
  }

  async canDelete(
    _args: DeleteID<TableSchema<'resources'>>,
    _tx: Transaction<Schema>,
  ): Promise<void> {
    throw new MutationACLError(
      'Resource delete failed: resources can only be deleted through backend services',
      'resources',
    );
  }
}
