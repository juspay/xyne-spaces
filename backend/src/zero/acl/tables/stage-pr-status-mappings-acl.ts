import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class StagePRStatusMappingsACL extends BaseACL<'stage_pr_status_mappings'> {

  async canInsert(args: InsertValue<TableSchema<'stage_pr_status_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    // Get the stage with its board to check if user is the board creator
    const stageWithBoard = await tx.run(zql.stages.where('id', args.stageId).related('board').one());

    if (!stageWithBoard || !stageWithBoard.board) {
      throw new MutationACLError(
        'Stage PR status mapping insert failed: the specified stage does not exist or has no board',
        'stage_pr_status_mappings'
      );
    }

    if (stageWithBoard.board.createdBy !== this.ctx.userID) {
      throw new MutationACLError(
        'Stage PR status mapping insert failed: only the board creator can add PR status mappings',
        'stage_pr_status_mappings'
      );
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'stage_pr_status_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    // Get the mapping with its stage and board to check if user is the board creator
    const mappingWithStageAndBoard = await tx.run(
      zql.stage_pr_status_mappings
        .where('id', args.id)
        .related('stage', (stage) => stage.related('board'))
        .one()
    );

    if (!mappingWithStageAndBoard || !mappingWithStageAndBoard.stage) {
      throw new MutationACLError(
        'Stage PR status mapping update failed: the mapping does not exist or has no stage',
        'stage_pr_status_mappings'
      );
    }

    if (!mappingWithStageAndBoard.stage.board) {
      throw new MutationACLError(
        'Stage PR status mapping update failed: the stage has no board',
        'stage_pr_status_mappings'
      );
    }

    if (mappingWithStageAndBoard.stage.board.createdBy !== this.ctx.userID) {
      throw new MutationACLError(
        'Stage PR status mapping update failed: only the board creator can modify PR status mappings',
        'stage_pr_status_mappings'
      );
    }
  }

  async canDelete(args: DeleteID<TableSchema<'stage_pr_status_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    // Get the mapping with its stage and board to check if user is the board creator
    const mappingWithStageAndBoard = await tx.run(
      zql.stage_pr_status_mappings
        .where('id', args.id)
        .related('stage', (stage) => stage.related('board'))
        .one()
    );

    if (!mappingWithStageAndBoard || !mappingWithStageAndBoard.stage) {
      throw new MutationACLError(
        'Stage PR status mapping delete failed: the mapping does not exist or has no stage',
        'stage_pr_status_mappings'
      );
    }

    if (!mappingWithStageAndBoard.stage.board) {
      throw new MutationACLError(
        'Stage PR status mapping delete failed: the stage has no board',
        'stage_pr_status_mappings'
      );
    }

    if (mappingWithStageAndBoard.stage.board.createdBy !== this.ctx.userID) {
      throw new MutationACLError(
        'Stage PR status mapping delete failed: only the board creator can delete PR status mappings',
        'stage_pr_status_mappings'
      );
    }
  }
}