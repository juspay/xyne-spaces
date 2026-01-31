import type { InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class BoardComplexityScoresACL extends BaseACL<'board_complexity_scores'> {

  async canInsert(args: InsertValue<TableSchema<'board_complexity_scores'>>, tx: Transaction<Schema>): Promise<void> {
    // Only group members can set board weights
    const membership = await tx.run(
      zql.user_group_mappings
        .where('userGroupId', args.userGroupId)
        .where('userId', this.ctx.userID)
        .one()
    );
    
    if (!membership) {
      throw new MutationACLError('Board complexity score insert failed: you must be a group member', 'board_complexity_scores');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'board_complexity_scores'>>, tx: Transaction<Schema>): Promise<void> {
    const score = await tx.run(zql.board_complexity_scores.where('id', args.id).one());
    
    if (!score) {
      throw new MutationACLError('Board complexity score update failed: score does not exist', 'board_complexity_scores');
    }

    // Only group members can update
    const membership = await tx.run(
      zql.user_group_mappings
        .where('userGroupId', score.userGroupId)
        .where('userId', this.ctx.userID)
        .one()
    );
    
    if (!membership) {
      throw new MutationACLError('Board complexity score update failed: you must be a group member', 'board_complexity_scores');
    }
  }

  async canUpsert(args: any, tx: Transaction<Schema>): Promise<void> {
    // Only group members can upsert
    const membership = await tx.run(
      zql.user_group_mappings
        .where('userGroupId', args.userGroupId)
        .where('userId', this.ctx.userID)
        .one()
    );
    
    if (!membership) {
      throw new MutationACLError('Board complexity score upsert failed: you must be a group member', 'board_complexity_scores');
    }
  }
}
