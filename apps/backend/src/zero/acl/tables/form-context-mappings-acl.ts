import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { FormContextType, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';
import { assertGuestWriteBlocked } from '../core/guest-access';
import { hasProjectAdminAccess } from '../core/admin-access';

export class FormContextMappingsACL extends BaseACL<'forms_context_mapping'> {

  private async verifyFormInWorkspace(formId: string, tx: Transaction<Schema>): Promise<void> {
    const form = await tx.run(zql.forms.where('id', formId).one());
    if (!form) {
      throw new MutationACLError('Form context mapping not found: form does not exist', 'forms_context_mapping');
    }
    // Direct workspaceId check - no user lookup needed
    if (form.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Form context mapping not found in this workspace', 'forms_context_mapping');
    }
  }

  // A form binding is shown to every user of the bound context (board/stage), so
  // binding/unbinding is an administrative action. Require the caller to administer
  // the referenced board/stage, mirroring BoardAcl (board creator or project admin).
  private async verifyBoardAdmin(boardId: string, tx: Transaction<Schema>): Promise<void> {
    const board = await tx.run(zql.boards.where('id', boardId).one());
    if (!board) {
      throw new MutationACLError('Form context mapping failed: the referenced board does not exist', 'forms_context_mapping');
    }
    if (board.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Form context mapping failed: board is not in this workspace', 'forms_context_mapping');
    }
    if (board.createdBy === this.ctx.userID) {
      return;
    }
    if (await hasProjectAdminAccess(this.ctx, tx)) {
      return;
    }
    throw new MutationACLError('Form context mapping failed: only the board creator or a project admin can bind forms to this context', 'forms_context_mapping');
  }

  private async verifyContextAccess(contextId: string, contextType: string, tx: Transaction<Schema>): Promise<void> {
    if (contextType === FormContextType.BOARD) {
      await this.verifyBoardAdmin(contextId, tx);
      return;
    }
    if (contextType === FormContextType.STAGE) {
      const stage = await tx.run(zql.stages.where('id', contextId).one());
      if (!stage) {
        throw new MutationACLError('Form context mapping failed: the referenced stage does not exist', 'forms_context_mapping');
      }
      if (stage.workspaceId !== this.ctx.workspaceId) {
        throw new MutationACLError('Form context mapping failed: stage is not in this workspace', 'forms_context_mapping');
      }
      await this.verifyBoardAdmin(stage.boardId, tx);
      return;
    }
    if (contextType === FormContextType.RELEASE_CHANGE) {
      const releaseChange = await tx.run(zql.release_changes.where('id', contextId).one());
      if (!releaseChange) {
        throw new MutationACLError('Form context mapping failed: the referenced release change does not exist', 'forms_context_mapping');
      }
      if (releaseChange.workspaceId !== this.ctx.workspaceId) {
        throw new MutationACLError('Form context mapping failed: release change is not in this workspace', 'forms_context_mapping');
      }
      if (!(await hasProjectAdminAccess(this.ctx, tx))) {
        throw new MutationACLError('Form context mapping failed: only a project admin can bind forms to a release change', 'forms_context_mapping');
      }
      return;
    }
    throw new MutationACLError('Form context mapping failed: unsupported context type', 'forms_context_mapping');
  }

  async canInsert(args: InsertValue<TableSchema<'forms_context_mapping'>>, tx: Transaction<Schema>): Promise<void> {
    assertGuestWriteBlocked(this.ctx, 'forms_context_mapping', 'insert', 'Form context mapping');
    await this.verifyFormInWorkspace(args.formId, tx);
    await this.verifyContextAccess(args.contextId, args.contextType as string, tx);
  }

  async canUpdate(args: UpdateValue<TableSchema<'forms_context_mapping'>>, tx: Transaction<Schema>): Promise<void> {
    assertGuestWriteBlocked(this.ctx, 'forms_context_mapping', 'update', 'Form context mapping');
    const mapping = await tx.run(zql.forms_context_mapping.where('id', args.id).one());
    if (!mapping) {
      throw new MutationACLError('Form context mapping update failed: record does not exist', 'forms_context_mapping');
    }
    // Validate the new form's workspace, not just the existing record's.
    await this.verifyFormInWorkspace((args.formId as string | undefined) ?? mapping.formId, tx);
    await this.verifyContextAccess(mapping.contextId, mapping.contextType as string, tx);
  }

  async canDelete(args: DeleteID<TableSchema<'forms_context_mapping'>>, tx: Transaction<Schema>): Promise<void> {
    assertGuestWriteBlocked(this.ctx, 'forms_context_mapping', 'delete', 'Form context mapping');
    const mapping = await tx.run(zql.forms_context_mapping.where('id', args.id).one());
    if (!mapping) {
      throw new MutationACLError('Form context mapping delete failed: record does not exist', 'forms_context_mapping');
    }
    await this.verifyContextAccess(mapping.contextId, mapping.contextType as string, tx);
  }
}
