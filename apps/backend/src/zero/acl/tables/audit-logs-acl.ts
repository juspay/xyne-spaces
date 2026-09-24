import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { MutationACLError, type TableSchema } from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { assertGuestWriteBlocked } from '../core/guest-access';

export class AuditLogsACL extends BaseACL<'audit_logs'> {
  async canInsert(args: InsertValue<TableSchema<'audit_logs'>>, _tx: Transaction<Schema>): Promise<void> {
    assertGuestWriteBlocked(this.ctx, 'audit_logs', 'insert', 'Audit log');
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Audit log insert failed: not in this workspace', 'audit_logs');
    }
    // Audit rows are written by server-side mutator code on behalf of the calling
    // user, so the actor cannot be attributed to someone else. Null is allowed for
    // system actors.
    if (args.actorUserId != null && args.actorUserId !== this.ctx.userID) {
      throw new MutationACLError('Audit log insert failed: actor must be the calling user', 'audit_logs');
    }
  }

  async canUpdate(_args: UpdateValue<TableSchema<'audit_logs'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Audit log update failed: audit logs are immutable records and cannot be modified', 'audit_logs');
  }

  async canDelete(_args: DeleteID<TableSchema<'audit_logs'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Audit log delete failed: audit logs are immutable records and cannot be deleted', 'audit_logs');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'audit_logs'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Audit log upsert failed: use insert operation only for new audit logs', 'audit_logs');
  }
}
