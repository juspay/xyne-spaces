import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class InstalledAppsACL extends BaseACL<'installed_apps'> {
  async canInsert(args: InsertValue<TableSchema<'installed_apps'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'installed_apps');
  }

  async canUpdate(args: UpdateValue<TableSchema<'installed_apps'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.installed_apps.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Installed app update failed: installed app does not exist', 'installed_apps');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'installed_apps');
  }

  async canDelete(args: DeleteID<TableSchema<'installed_apps'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.installed_apps.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Installed app delete failed: installed app does not exist', 'installed_apps');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'installed_apps');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'installed_apps'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Installed app upsert failed: use insert or update separately', 'installed_apps');
  }
}
