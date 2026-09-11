import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class ProjectTagsACL extends BaseACL<'project_tags'> {

  private async verifyProjectInWorkspace(projectId: string, tx: Transaction<Schema>): Promise<void> {
    const project = await tx.run(zql.projects.where('id', projectId).one());
    if (!project) throw new MutationACLError('Project tag not found: project does not exist', 'project_tags');
    if (project.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Project tag not found in this workspace', 'project_tags');
    }
  }

  private async verifyGuestScope(projectId: string, tx: Transaction<Schema>): Promise<void> {
    const project = await tx.run(zql.projects.where('id', projectId).one());
    if (!project) {
      throw new MutationACLError('Project tag failed: project does not exist', 'project_tags');
    }
    if (project.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Project tag failed: not in this workspace', 'project_tags');
    }
    const hasAccess = false;
    if (!hasAccess) {
      throw new MutationACLError('Project tag failed: guest does not have access to this project', 'project_tags');
    }
  }

  private async resolveProjectIdFromTag(tagId: string, tx: Transaction<Schema>): Promise<string> {
    const tag = await tx.run(zql.project_tags.where('id', tagId).one());
    if (!tag) {
      throw new MutationACLError('Project tag failed: tag does not exist', 'project_tags');
    }
    return tag.projectId;
  }

  async canInsert(args: InsertValue<TableSchema<'project_tags'>>, tx: Transaction<Schema>): Promise<void> {
    if (this.ctx.role === 'GUEST') {
      await this.verifyGuestScope(args.projectId, tx);
      return;
    }
    await this.verifyProjectInWorkspace(args.projectId, tx);
  }

  async canUpdate(args: UpdateValue<TableSchema<'project_tags'>>, tx: Transaction<Schema>): Promise<void> {
    if (this.ctx.role === 'GUEST') {
      const projectId = await this.resolveProjectIdFromTag(args.id, tx);
      await this.verifyGuestScope(projectId, tx);
      return;
    }
    const tag = await tx.run(zql.project_tags.where('id', args.id).one());
    if (tag) {
      await this.verifyProjectInWorkspace(tag.projectId, tx);
    }
  }

  async canDelete(args: DeleteID<TableSchema<'project_tags'>>, tx: Transaction<Schema>): Promise<void> {
    if (this.ctx.role === 'GUEST') {
      const projectId = await this.resolveProjectIdFromTag(args.id, tx);
      await this.verifyGuestScope(projectId, tx);
      return;
    }
    const tag = await tx.run(zql.project_tags.where('id', args.id).one());
    if (tag) {
      await this.verifyProjectInWorkspace(tag.projectId, tx);
    }
  }

  async canUpsert(_args: UpsertValue<TableSchema<'project_tags'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Project tag upsert failed: use insert or update operations separately', 'project_tags');
  }
}
