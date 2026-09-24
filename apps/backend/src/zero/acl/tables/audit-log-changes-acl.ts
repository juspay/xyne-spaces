import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { MutationACLError, type TableSchema } from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';
import { assertGuestWriteBlocked } from '../core/guest-access';

export class AuditLogChangesACL extends BaseACL<'audit_log_changes'> {
  async canInsert(args: InsertValue<TableSchema<'audit_log_changes'>>, tx: Transaction<Schema>): Promise<void> {
    assertGuestWriteBlocked(this.ctx, 'audit_log_changes', 'insert', 'Audit log change');
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Audit log change insert failed: not in this workspace', 'audit_log_changes');
    }
    const parentAuditLog = await tx.run(zql.audit_logs.where('id', args.auditLogId).one());
    if (!parentAuditLog || parentAuditLog.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Audit log change insert failed: parent audit log not found in this workspace', 'audit_log_changes');
    }
  }

  async canUpdate(_args: UpdateValue<TableSchema<'audit_log_changes'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Audit log change update failed: audit log changes are immutable records and cannot be modified', 'audit_log_changes');
  }

  async canDelete(_args: DeleteID<TableSchema<'audit_log_changes'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Audit log change delete failed: audit log changes are immutable records and cannot be deleted', 'audit_log_changes');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'audit_log_changes'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Audit log change upsert failed: use insert operation only for new audit log changes', 'audit_log_changes');
  }
}
