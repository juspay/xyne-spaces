import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class GlobalFieldsACL extends BaseACL<'global_fields'> {
  async canInsert(args: InsertValue<TableSchema<'global_fields'>>, tx: Transaction<Schema>): Promise<void> {
    const project = await tx.run(zql.projects.where('id', args.projectId).one());
    if (!project) {
      throw new MutationACLError('Global field insert failed: project does not exist', 'global_fields');
    }
    if (project.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Global field insert failed: project workspace mismatch', 'global_fields');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'global_fields'>>, tx: Transaction<Schema>): Promise<void> {
    const field = await tx.run(zql.global_fields.where('id', args.id).one());
    if (!field) {
      throw new MutationACLError('Global field update failed: field does not exist', 'global_fields');
    }
    const project = await tx.run(zql.projects.where('id', field.projectId).one());
    if (!project || project.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Global field update failed: project workspace mismatch', 'global_fields');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'global_fields'>>, tx: Transaction<Schema>): Promise<void> {
    const field = await tx.run(zql.global_fields.where('id', args.id).one());
    if (!field) {
      throw new MutationACLError('Global field delete failed: field does not exist', 'global_fields');
    }
    const project = await tx.run(zql.projects.where('id', field.projectId).one());
    if (!project || project.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Global field delete failed: project workspace mismatch', 'global_fields');
    }
  }
}
