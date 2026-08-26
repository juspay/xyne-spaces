import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { isActiveConnectMember } from '../core/guest-access';
import { zql } from '../../queries';

export class CanvasVersionsACL extends BaseACL<'canvas_versions'> {
  // Slack-Connect: an active connect member may mutate a version whose canvas is hosted in the
  // (cross-org) connect channel. Resolve the host channelId via the version's canvas.
  private async isConnectCanvasVersion(
    canvasId: string | null | undefined,
    tx: Transaction<Schema>,
  ): Promise<boolean> {
    if (!canvasId) return false;
    const canvas = await tx.run(zql.canvases.where('id', canvasId).one());
    if (!canvas?.channelId) return false;
    return isActiveConnectMember(this.ctx, tx, canvas.channelId);
  }

  async canInsert(args: InsertValue<TableSchema<'canvas_versions'>>, tx: Transaction<Schema>): Promise<void> {
    if (await this.isConnectCanvasVersion(args.canvasId as string, tx)) {
      return;
    }
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'canvas_versions');
  }

  async canUpdate(args: UpdateValue<TableSchema<'canvas_versions'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.canvas_versions.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Canvas version update failed: version does not exist', 'canvas_versions');
    }
    if (await this.isConnectCanvasVersion(row.canvasId, tx)) {
      return;
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'canvas_versions');
  }

  async canDelete(args: DeleteID<TableSchema<'canvas_versions'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.canvas_versions.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Canvas version delete failed: version does not exist', 'canvas_versions');
    }
    if (await this.isConnectCanvasVersion(row.canvasId, tx)) {
      return;
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'canvas_versions');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'canvas_versions'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Canvas version upsert failed: use insert or update separately', 'canvas_versions');
  }
}
