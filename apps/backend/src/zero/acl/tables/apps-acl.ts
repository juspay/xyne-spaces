import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared'
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';
import { assertGuestWriteBlocked } from '../core/guest-access';

export class AppsACL extends BaseACL<'apps'> {

  // The creator (implicit ADMIN) or any collaborator (ADMIN or CONTRIBUTOR) may edit the app
  // template (commands/permissions/webhook/description).
  private async canEditTemplate(app: { createdBy: string; id: string }, tx: Transaction<Schema>): Promise<boolean> {
    if (app.createdBy === this.ctx.userID) {
      return true;
    }
    const collaborator = await tx.run(
      zql.app_collaborators.where('appId', app.id).where('userId', this.ctx.userID).one(),
    );
    return !!collaborator;
  }

  async canInsert(args: InsertValue<TableSchema<'apps'>>, _tx: Transaction<Schema>): Promise<void> {
    assertGuestWriteBlocked(this.ctx, 'apps', 'insert', 'App');
    // Pin createdBy to the authenticated caller so an insert cannot attribute the
    // app to another user.
    if (args.createdBy && args.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Cannot create an app for another user', 'apps');
    }
    // Enforce the app is created in the caller's own workspace/tenant.
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('App insert failed: workspace mismatch', 'apps');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'apps'>>, tx: Transaction<Schema>): Promise<void> {
    assertGuestWriteBlocked(this.ctx, 'apps', 'update', 'App');
    const app = await tx.run(zql.apps.where('id', args.id).one());
    if (!app) {
      throw new MutationACLError('App update failed: app does not exist', 'apps');
    }

    if (await this.canEditTemplate(app, tx)) {
      return;
    }

    throw new MutationACLError('App update failed: only the app creator or a collaborator can modify this app', 'apps');
  }

  async canDelete(_args: DeleteID<TableSchema<'apps'>>, _tx: Transaction<Schema>): Promise<void> {
    assertGuestWriteBlocked(this.ctx, 'apps', 'delete', 'App');
    throw new MutationACLError('App delete failed: apps cannot be deleted', 'apps');
  }

  async canUpsert(args: UpsertValue<TableSchema<'apps'>>, tx: Transaction<Schema>): Promise<void> {
    assertGuestWriteBlocked(this.ctx, 'apps', 'upsert', 'App');
    const app = await tx.run(zql.apps.where('id', args.id).one());
    if (!app) {
      throw new MutationACLError('App upsert failed: app does not exist for update', 'apps');
    }

    if (await this.canEditTemplate(app, tx)) {
      return;
    }

    throw new MutationACLError('App upsert failed: only the app creator or a collaborator can modify this app', 'apps');
  }
}
