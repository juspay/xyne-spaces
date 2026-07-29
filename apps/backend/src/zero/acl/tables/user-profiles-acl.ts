import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class UserProfilesACL extends BaseACL<'user_profiles'> {

  private async verifyWorkspace(userId: string, tx: Transaction<Schema>): Promise<void> {
    const user = await tx.run(zql.users.where('id', userId).one());
    if (!user || user.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('User profile not found in this workspace', 'user_profiles');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'user_profiles'>>, tx: Transaction<Schema>): Promise<void> {
    if (args.userId !== this.ctx.userID) {
      throw new MutationACLError('User profile insert failed: you can only create your own profile', 'user_profiles');
    }
    await this.verifyWorkspace(args.userId, tx);
  }

  async canUpdate(args: UpdateValue<TableSchema<'user_profiles'>>, tx: Transaction<Schema>): Promise<void> {
    const profile = await tx.run(zql.user_profiles.where('id', args.id).one());
    if (!profile) {
      throw new MutationACLError('User profile update failed: profile does not exist', 'user_profiles');
    }
    if (profile.userId !== this.ctx.userID) {
      throw new MutationACLError('User profile update failed: you can only update your own profile', 'user_profiles');
    }
    await this.verifyWorkspace(profile.userId, tx);
  }

  async canDelete(_args: DeleteID<TableSchema<'user_profiles'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('User profile delete failed: profiles cannot be deleted', 'user_profiles');
  }

  async canUpsert(args: UpsertValue<TableSchema<'user_profiles'>>, tx: Transaction<Schema>): Promise<void> {
    const profile = await tx.run(zql.user_profiles.where('id', args.id).one());
    if (profile) {
      if (profile.userId !== this.ctx.userID) {
        throw new MutationACLError('User profile upsert failed: you can only update your own profile', 'user_profiles');
      }
      await this.verifyWorkspace(profile.userId, tx);
    } else {
      if (args.userId !== this.ctx.userID) {
        throw new MutationACLError('User profile upsert failed: you can only create your own profile', 'user_profiles');
      }
      await this.verifyWorkspace(args.userId, tx);
    }
  }
}
