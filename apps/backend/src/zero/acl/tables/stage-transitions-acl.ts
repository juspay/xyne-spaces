import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class StageTransitionsACL extends BaseACL<'stage_transitions'> {
  // Slack-Connect: is the caller an active connect member of ANY channel belonging to this
  // board's project? Stage transitions reach a channel only via board -> project -> channels
  // (potentially several channels), so we resolve membership across the project's channels.
  private async isConnectMemberOfBoardProject(boardId: string, tx: Transaction<Schema>): Promise<boolean> {
    const board = await tx.run(zql.boards.where('id', boardId).one());
    if (!board) return false;
    const connectChannel = await tx.run(
      zql.channels
        .where('projectId', board.projectId)
        .whereExists('connectMembers', (m: any) =>
          m.where('userId', this.ctx.userID).where('leftAt', 'IS', null),
        )
        .one(),
    );
    return Boolean(connectChannel);
  }

  async canInsert(args: InsertValue<TableSchema<'stage_transitions'>>, tx: Transaction<Schema>): Promise<void> {
    // Slack-Connect: an active connect member of the board's project channel may add transitions cross-org.
    if (args.boardId && (await this.isConnectMemberOfBoardProject(args.boardId as string, tx))) return;
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'stage_transitions');
  }

  async canUpdate(args: UpdateValue<TableSchema<'stage_transitions'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.stage_transitions.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Stage transition update failed: transition does not exist', 'stage_transitions');
    }
    // Slack-Connect: an active connect member of the board's project channel may modify transitions cross-org.
    if (await this.isConnectMemberOfBoardProject(row.boardId, tx)) return;
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'stage_transitions');
  }

  async canDelete(args: DeleteID<TableSchema<'stage_transitions'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.stage_transitions.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Stage transition delete failed: transition does not exist', 'stage_transitions');
    }
    // Slack-Connect: an active connect member of the board's project channel may delete transitions cross-org.
    if (await this.isConnectMemberOfBoardProject(row.boardId, tx)) return;
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'stage_transitions');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'stage_transitions'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Stage transition upsert failed: use insert or update separately', 'stage_transitions');
  }
}
