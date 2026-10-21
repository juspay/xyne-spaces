import type { Transaction } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { MutationACLError, type QueryContext } from './types';
import { assertWorkspaceMatch } from './workspace-match';
import { zql } from '../../queries';

/**
 * Slack Connect — mutation authorization for connectId-bearing canvas tables (the write-side mirror of
 * the read `connectReach` and the Prisma `canWorkspaceReachConnect` gate).
 *
 * When the row carries a `connectId`, the caller may mutate it iff their workspace is the host or an
 * ACTIVE invited workspace of that connect group. A row without a connectId (un-backfilled) falls back
 * to the legacy `workspaceId` match. Phase 1 groups are host-private, so this is behaviour-neutral
 * (only the host workspace is in the group), and it is ready for invited writes once sharing exists.
 */
export async function assertConnectMutateAllowed(
  ctx: QueryContext,
  tx: Transaction<Schema>,
  row: { connectId?: string | null; workspaceId?: string | null },
  tableName: string,
): Promise<void> {
  if (!row.connectId) {
    // No connect group yet → legacy tenant check (same as pre-Connect).
    assertWorkspaceMatch(ctx, row.workspaceId, tableName);
    return;
  }
  const groups = await tx.run(
    zql.connect_group.where('connectId', row.connectId).where('status', 'ACTIVE'),
  );
  for (const g of groups) {
    if (g.hostWorkspaceId === ctx.workspaceId || g.invitedWorkspaceId === ctx.workspaceId) {
      return;
    }
  }
  throw new MutationACLError(
    `${tableName} operation failed: workspace is not in this connect group`,
    tableName,
  );
}
