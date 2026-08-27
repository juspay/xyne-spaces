import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

type CollaboratorRow = { appId: string; userId: string; collaboratorType: string };

export class AppCollaboratorsACL extends BaseACL<'app_collaborators'> {

  /** Only the app creator (implicit ADMIN) or an ADMIN collaborator may manage collaborators. */
  private async assertCanManage(appId: string, tx: Transaction<Schema>): Promise<void> {
    const app = await tx.run(zql.apps.where('id', appId).one());
    if (!app) {
      throw new MutationACLError('Collaborator change failed: app does not exist', 'app_collaborators');
    }
    if (app.createdBy === this.ctx.userID) {
      return;
    }
    const adminRow = await tx.run(
      zql.app_collaborators
        .where('appId', appId)
        .where('userId', this.ctx.userID)
        .where('collaboratorType', 'ADMIN')
        .one(),
    );
    if (adminRow) {
      return;
    }
    throw new MutationACLError('Collaborator change failed: only an app admin can manage collaborators', 'app_collaborators');
  }

  /** The last ADMIN cannot be removed or demoted — the app would become unmanageable again. */
  private async assertNotLastAdmin(row: CollaboratorRow, tx: Transaction<Schema>): Promise<void> {
    if (row.collaboratorType !== 'ADMIN') {
      return;
    }
    const admins = await tx.run(
      zql.app_collaborators.where('appId', row.appId).where('collaboratorType', 'ADMIN'),
    );
    if (admins.length <= 1) {
      throw new MutationACLError('Collaborator change failed: an app must keep at least one admin', 'app_collaborators');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'app_collaborators'>>, tx: Transaction<Schema>): Promise<void> {
    await this.assertCanManage(args.appId, tx);

    const existing = await tx.run(
      zql.app_collaborators.where('appId', args.appId).where('userId', args.userId).one(),
    );
    if (existing) {
      throw new MutationACLError('Collaborator insert failed: user is already a collaborator', 'app_collaborators');
    }

    const user = await tx.run(zql.users.where('id', args.userId).one());
    if (!user) {
      throw new MutationACLError('Collaborator insert failed: user does not exist', 'app_collaborators');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'app_collaborators'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.app_collaborators.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Collaborator update failed: collaborator does not exist', 'app_collaborators');
    }

    await this.assertCanManage(row.appId, tx);

    // Only the role may change; appId/userId are immutable.
    if (args.appId !== undefined && args.appId !== row.appId) {
      throw new MutationACLError('Collaborator update failed: appId cannot be changed', 'app_collaborators');
    }
    if (args.userId !== undefined && args.userId !== row.userId) {
      throw new MutationACLError('Collaborator update failed: userId cannot be changed', 'app_collaborators');
    }

    // Demotion of the last admin is refused.
    if (args.collaboratorType !== undefined && args.collaboratorType !== row.collaboratorType) {
      await this.assertNotLastAdmin(row, tx);
    }
  }

  async canDelete(args: DeleteID<TableSchema<'app_collaborators'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.app_collaborators.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Collaborator delete failed: collaborator does not exist', 'app_collaborators');
    }

    await this.assertCanManage(row.appId, tx);
    await this.assertNotLastAdmin(row, tx);
  }

  async canUpsert(_args: UpsertValue<TableSchema<'app_collaborators'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Collaborator upsert is not supported — use insert or update', 'app_collaborators');
  }
}
