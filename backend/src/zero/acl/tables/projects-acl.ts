import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
    MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared'
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class ProjectAcl extends BaseACL<'projects'> {

    async canInsert(_args: InsertValue<TableSchema<'projects'>>, _tx: Transaction<Schema>): Promise<void> {
      // For now anyone can insert a project
    }

    async canUpdate(args: UpdateValue<TableSchema<'projects'>>, tx: Transaction<Schema>): Promise<void> {
        const project = await tx.run(zql.projects.where('id', args.id).one());
        if (!project) {
            throw new MutationACLError('Project update failed: project does not exist', 'projects');
        }
        if (project.createdBy !== this.ctx.userID) {
            throw new MutationACLError('Project update failed: only the project creator can modify this project', 'projects');
        }
    }

    async canDelete(args: DeleteID<TableSchema<'projects'>>, tx: Transaction<Schema>): Promise<void> {
        const project = await tx.run(zql.projects.where('id', args.id).one());
        if (!project) {
            throw new MutationACLError('Project delete failed: project does not exist', 'projects');
        }
        if (project.createdBy !== this.ctx.userID) {
            throw new MutationACLError('Project delete failed: only the project creator can delete this project', 'projects');
        }
    }

    async canUpsert(args: UpsertValue<TableSchema<'projects'>>, tx: Transaction<Schema>): Promise<void> {
        const project = await tx.run(zql.projects.where('id', args.id).one());
        if (!project) {
            throw new MutationACLError('Project upsert failed: project does not exist for update', 'projects');
        }
        if (project.createdBy !== this.ctx.userID) {
            throw new MutationACLError('Project upsert failed: only the project creator can modify this project', 'projects');
        }
    }
}