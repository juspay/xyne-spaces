import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
    MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared'
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';
import { hasProjectAdminAccess } from '../core/admin-access';

export class ProjectAcl extends BaseACL<'projects'> {

    async canInsert(_args: InsertValue<TableSchema<'projects'>>, tx: Transaction<Schema>): Promise<void> {
        // Only project admins can insert projects
        const hasAdminAccess = await hasProjectAdminAccess(this.ctx, tx);
        if (!hasAdminAccess) {
            throw new MutationACLError('Project insert failed: only project admins can create projects', 'projects');
        }
    }

    async canUpdate(args: UpdateValue<TableSchema<'projects'>>, tx: Transaction<Schema>): Promise<void> {
        const project = await tx.run(zql.projects.where('id', args.id).one());
        if (!project) {
            throw new MutationACLError('Project update failed: project does not exist', 'projects');
        }

        // Allow if user is the creator
        if (project.createdBy === this.ctx.userID) {
            return;
        }

        // Allow if user has PROJECT ADMIN access
        const hasAdminAccess = await hasProjectAdminAccess(this.ctx, tx);
        if (hasAdminAccess) {
            return;
        }

        throw new MutationACLError('Project update failed: only the project creator or project admin can modify this project', 'projects');
    }

    async canDelete(args: DeleteID<TableSchema<'projects'>>, tx: Transaction<Schema>): Promise<void> {
        const project = await tx.run(zql.projects.where('id', args.id).one());
        if (!project) {
            throw new MutationACLError('Project delete failed: project does not exist', 'projects');
        }

        // Allow if user is the creator
        if (project.createdBy === this.ctx.userID) {
            return;
        }

        // Allow if user has PROJECT ADMIN access
        const hasAdminAccess = await hasProjectAdminAccess(this.ctx, tx);
        if (hasAdminAccess) {
            return;
        }

        throw new MutationACLError('Project delete failed: only the project creator or project admin can delete this project', 'projects');
    }

    async canUpsert(args: UpsertValue<TableSchema<'projects'>>, tx: Transaction<Schema>): Promise<void> {
        const project = await tx.run(zql.projects.where('id', args.id).one());
        if (!project) {
            throw new MutationACLError('Project upsert failed: project does not exist for update', 'projects');
        }

        // Allow if user is the creator
        if (project.createdBy === this.ctx.userID) {
            return;
        }

        // Allow if user has PROJECT ADMIN access
        const hasAdminAccess = await hasProjectAdminAccess(this.ctx, tx);
        if (hasAdminAccess) {
            return;
        }

        throw new MutationACLError('Project upsert failed: only the project creator or project admin can modify this project', 'projects');
    }
}