import type { InsertValue, Transaction } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';

/**
 * Slack Connect — `connect_group` is written exactly once per channel/canvas, from *inside* the
 * canvas/channel create mutators (`tx.mutate.connect_group.insert`). Because every nested mutate
 * goes through this ACL, falling back to BaseACL would throw ("Acl not defined for inserts") and
 * roll the whole creation transaction back — so canvas/channel creation from the Zero (dashboard)
 * path would fail server-side.
 *
 * We allow the insert but pin it to the caller's own workspace: you may only create a group your
 * workspace hosts (the invited side is NULL in this phase). Update/delete/upsert stay denied via
 * BaseACL's throwing defaults — no mutator performs them.
 */
export class ConnectGroupACL extends BaseACL<'connect_group'> {
  async canInsert(
    args: InsertValue<TableSchema<'connect_group'>>,
    _tx: Transaction<Schema>,
  ): Promise<void> {
    if (args.hostWorkspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError(
        'connect_group insert failed: hostWorkspaceId must be the caller workspace',
        'connect_group',
      );
    }
  }
}
