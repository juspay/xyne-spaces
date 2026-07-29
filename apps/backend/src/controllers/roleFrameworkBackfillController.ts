import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';

/**
 * Role framework backfill controller.
 *
 * One endpoint, multiple modes. The `mode` param in the request body selects
 * which backfill to run. Modes are additive and idempotent — re-running a
 * mode on already-backfilled data is a no-op.
 *
 * Modes:
 * - `seedDefaultRoles`: For every workspace, insert the 5 default roles
 *   (MANAGER, TEAM_LEAD, MEMBER, PR_REVIEWER, QA) into the `roles` table if
 *   they don't already exist. Uses deterministic IDs
 *   (`{workspaceId}-ROLE-{NAME}`) so downstream backfills can join by name.
 *   Must run before any other role-framework backfill mode.
 * - `userGroupMappingsRoleId`: set `user_group_mappings.roleId` from
 *   `responsibility` via join to the seeded roles (additive — never nulls
 *   `responsibility`).
 * - `boardMetadata`: per board, write three keys into `boards.metadata`:
 *   `assignmentRoles` (when `fullRoleAssignment === true`),
 *   `ticketControlRoleIds` (when `isAllowedToTransfer === true`),
 *   `bitbucketEventRoles` (always). Idempotent — skips a key if already set.
 * - `stageApproversApproverType`: set `stage_approvers.approverType = 'USER'`
 *   where NULL. Idempotent — only touches rows where approverType IS NULL.
 */

export type RoleFrameworkBackfillMode =
  | 'seedDefaultRoles'
  | 'userGroupMappingsRoleId'
  | 'boardMetadata'
  | 'stageApproversApproverType';

type BackfillOptions = {
  batchSize: number;
  delayMs: number;
  dryRun: boolean;
};

type BackfillSummary = {
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
};

const DEFAULT_ROLE_NAMES = [
  'MANAGER',
  'TEAM_LEAD',
  'MEMBER',
  'PR_REVIEWER',
  'QA',
] as const;

export class RoleFrameworkBackfillController {
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static buildDefaultOptions(body: unknown): BackfillOptions {
    const payload = body as Partial<{
      batchSize: number;
      delayMs: number;
      dryRun: boolean;
    }>;

    const batchSize = payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 50;
    const delayMs = payload.delayMs && payload.delayMs >= 0 ? payload.delayMs : 100;
    const dryRun = payload.dryRun === true;

    return { batchSize, delayMs, dryRun };
  }

  private static parseMode(body: unknown): RoleFrameworkBackfillMode | null {
    const payload = body as Partial<{ mode: string }>;
    if (!payload.mode || typeof payload.mode !== 'string') return null;
    const validModes: RoleFrameworkBackfillMode[] = [
      'seedDefaultRoles',
      'userGroupMappingsRoleId',
      'boardMetadata',
      'stageApproversApproverType',
    ];
    return validModes.includes(payload.mode as RoleFrameworkBackfillMode)
      ? (payload.mode as RoleFrameworkBackfillMode)
      : null;
  }

  /**
   * Seed 5 default roles (MANAGER, TEAM_LEAD, MEMBER, PR_REVIEWER, QA) per
   * workspace. Idempotent — workspaces that already have all 5 roles are
   * skipped. Uses deterministic IDs `{workspaceId}-ROLE-{NAME}` so downstream
   * backfills can join by name.
   *
   * Fetches all workspaces once, then processes them in fixed batches of 10
   * (up to 50 role inserts per batch — one createMany call per workspace).
   * Waits 2 seconds between batches to avoid hammering the DB.
   */
  private static async seedDefaultRoles(
    options: BackfillOptions,
    runId: string,
  ): Promise<BackfillSummary> {
    const TAG = '[RoleFrameworkBackfill][seedDefaultRoles]';
    const summary: BackfillSummary = { processed: 0, updated: 0, skipped: 0, errors: 0 };
    const BATCH_SIZE = 10;
    const BATCH_DELAY_MS = 2000;

    logger.info(`${TAG} backfill start`, {
      runId,
      dryRun: options.dryRun,
      batchSize: BATCH_SIZE,
      batchDelayMs: BATCH_DELAY_MS,
    });

    const workspaces = await db.workspace.findMany({
      select: { id: true, createdBy: true },
      orderBy: { id: 'asc' },
    });

    logger.info(`${TAG} fetched workspaces`, {
      runId,
      totalWorkspaces: workspaces.length,
    });

    if (workspaces.length === 0) {
      logger.info(`${TAG} backfill end — no workspaces to process`, {
        runId,
        summary,
      });
      return summary;
    }

    const totalBatches = Math.ceil(workspaces.length / BATCH_SIZE);

    for (let i = 0; i < workspaces.length; i += BATCH_SIZE) {
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const batch = workspaces.slice(i, i + BATCH_SIZE);
      const batchStartIndex = i + 1;
      const batchEndIndex = Math.min(i + BATCH_SIZE, workspaces.length);
      const batchInserted = { roles: 0, workspacesSkipped: 0, workspacesErrored: 0 };

      logger.info(`${TAG} batch ${batchNumber}/${totalBatches} start`, {
        runId,
        batchNumber,
        totalBatches,
        workspaceRange: `${batchStartIndex}-${batchEndIndex} of ${workspaces.length}`,
        workspaceIds: batch.map(w => w.id),
      });

      for (const workspace of batch) {
        summary.processed += 1;
        try {
          const existingRoles = await db.role.findMany({
            where: {
              workspaceId: workspace.id,
              name: { in: [...DEFAULT_ROLE_NAMES] },
            },
            select: { name: true },
          });
          const existingNames = new Set(existingRoles.map(r => r.name));
          const toCreate = DEFAULT_ROLE_NAMES.filter(name => !existingNames.has(name));

          if (toCreate.length === 0) {
            summary.skipped += 1;
            batchInserted.workspacesSkipped += 1;
            continue;
          }

          if (!options.dryRun) {
            const now = new Date();
            await db.role.createMany({
              data: toCreate.map(name => ({
                id: `${workspace.id}-ROLE-${name}`,
                workspaceId: workspace.id,
                name,
                description: null,
                createdBy: workspace.createdBy,
                createdAt: now,
                updatedAt: now,
                isActive: true,
              })),
            });
          }
          summary.updated += toCreate.length;
          batchInserted.roles += toCreate.length;
        } catch (error) {
          summary.errors += 1;
          batchInserted.workspacesErrored += 1;
          logger.error(`${TAG} batch ${batchNumber} — error seeding workspace`, {
            runId,
            batchNumber,
            workspaceId: workspace.id,
            error: error,
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
      }

      logger.info(`${TAG} batch ${batchNumber}/${totalBatches} complete`, {
        runId,
        batchNumber,
        totalBatches,
        rolesInserted: batchInserted.roles,
        workspacesSkipped: batchInserted.workspacesSkipped,
        workspacesErrored: batchInserted.workspacesErrored,
        runningTotals: {
          processed: summary.processed,
          updated: summary.updated,
          skipped: summary.skipped,
          errors: summary.errors,
        },
      });

      // Wait 2s between batches (skip the wait after the last batch and in dry-run).
      const isLastBatch = i + BATCH_SIZE >= workspaces.length;
      if (!isLastBatch && !options.dryRun) {
        await RoleFrameworkBackfillController.sleep(BATCH_DELAY_MS);
      }
    }

    logger.info(`${TAG} backfill end`, {
      runId,
      totalWorkspaces: workspaces.length,
      summary,
    });

    return summary;
  }

  /**
   * Backfill `user_group_mappings.roleId` from the legacy `responsibility`
   * enum column. Additive-only — never nulls `responsibility`.
   *
   * For each mapping row where `roleId IS NULL AND responsibility IS NOT NULL`,
   * derive the roleId as `{workspaceId}-ROLE-{responsibility}` (via the
   * user_group → workspace join) and set it. Requires `seedDefaultRoles` to
   * have run first so the target role rows exist.
   *
   * Iterates over userGroups (not workspaces). For each userGroup, fetches its
   * members needing backfill, then processes those mappings in chunks of 50
   * with a 1-second delay between chunks. A userGroup with >50 members is
   * chunked internally — 50 mappings per DB round-trip, 1s wait after each.
   * Goal: ~50 DB writes per second.
   */
  private static async backfillUserGroupMappingsRoleId(
    options: BackfillOptions,
    runId: string,
  ): Promise<BackfillSummary> {
    const TAG = '[RoleFrameworkBackfill][userGroupMappingsRoleId]';
    const summary: BackfillSummary = { processed: 0, updated: 0, skipped: 0, errors: 0 };
    const CHUNK_SIZE = 50;
    const CHUNK_DELAY_MS = 1000;

    logger.info(`${TAG} backfill start`, {
      runId,
      dryRun: options.dryRun,
      chunkSize: CHUNK_SIZE,
      chunkDelayMs: CHUNK_DELAY_MS,
    });

    const userGroups = await db.userGroup.findMany({
      select: { id: true, workspaceId: true, name: true },
      orderBy: { id: 'asc' },
    });

    logger.info(`${TAG} fetched userGroups`, {
      runId,
      totalUserGroups: userGroups.length,
    });

    if (userGroups.length === 0) {
      logger.info(`${TAG} backfill end — no userGroups to process`, {
        runId,
        summary,
      });
      return summary;
    }

    let chunkIndex = 0;

    for (let ug = 0; ug < userGroups.length; ug += 1) {
      const userGroup = userGroups[ug];
      const userGroupNumber = ug + 1;

      try {
        // Fetch members of this userGroup needing backfill. roleId IS NULL AND
        // responsibility IS NOT NULL — additive only, never touches rows that
        // already have a roleId or have no legacy enum to derive from.
        const mappingsNeedingBackfill = await db.userGroupMapping.findMany({
          where: {
            userGroupId: userGroup.id,
            roleId: null,
            responsibility: { not: null },
          },
          select: { id: true, responsibility: true },
          orderBy: { id: 'asc' },
        });

        summary.processed += mappingsNeedingBackfill.length;

        if (mappingsNeedingBackfill.length === 0) {
          summary.skipped += 1;
          logger.info(`${TAG} userGroup ${userGroupNumber}/${userGroups.length} — no mappings to backfill`, {
            runId,
            userGroupId: userGroup.id,
            userGroupName: userGroup.name,
            workspaceId: userGroup.workspaceId,
          });
          continue;
        }

        // Group by responsibility so we can issue one updateMany per
        // responsibility value (roleId is a function of responsibility).
        const byResponsibility = new Map<string, string[]>();
        for (const m of mappingsNeedingBackfill) {
          const responsibility = m.responsibility as string;
          const list = byResponsibility.get(responsibility) ?? [];
          list.push(m.id);
          byResponsibility.set(responsibility, list);
        }

        // Flatten to per-responsibility chunks of CHUNK_SIZE. Each updateMany
        // is one DB round-trip. After every chunk (across all responsibilities
        // of this userGroup), wait CHUNK_DELAY_MS so we cap at ~50 writes/sec.
        const totalChunks = Math.ceil(mappingsNeedingBackfill.length / CHUNK_SIZE);
        const responsibilities = [...byResponsibility.keys()];
        const lastResponsibility = responsibilities[responsibilities.length - 1];

        logger.info(`${TAG} userGroup ${userGroupNumber}/${userGroups.length} start`, {
          runId,
          userGroupId: userGroup.id,
          userGroupName: userGroup.name,
          workspaceId: userGroup.workspaceId,
          mappingsNeedingBackfill: mappingsNeedingBackfill.length,
          responsibilities: byResponsibility.size,
          expectedChunks: totalChunks,
        });

        let userGroupUpdated = 0;
        let userGroupErrors = 0;

        for (const responsibility of responsibilities) {
          const mappingIds = byResponsibility.get(responsibility)!;
          const roleId = `${userGroup.workspaceId}-ROLE-${responsibility}`;

          for (let s = 0; s < mappingIds.length; s += CHUNK_SIZE) {
            chunkIndex += 1;
            const chunk = mappingIds.slice(s, s + CHUNK_SIZE);
            const chunkNumber = chunkIndex;
            const isLastChunkOfUserGroup =
              s + CHUNK_SIZE >= mappingIds.length &&
              responsibility === lastResponsibility;

            try {
              if (!options.dryRun) {
                const result = await db.userGroupMapping.updateMany({
                  where: { id: { in: chunk } },
                  data: { roleId },
                });
                userGroupUpdated += result.count;
              } else {
                userGroupUpdated += chunk.length;
              }
            } catch (error) {
              userGroupErrors += 1;
              summary.errors += 1;
              logger.error(`${TAG} userGroup ${userGroupNumber} — error updating chunk`, {
                runId,
                chunkNumber,
                userGroupId: userGroup.id,
                responsibility,
                roleId,
                chunkSize: chunk.length,
                error: error,
                stack: error instanceof Error ? error.stack : undefined,
              });
            }

            logger.info(`${TAG} chunk ${chunkNumber} complete`, {
              runId,
              chunkNumber,
              userGroupId: userGroup.id,
              responsibility,
              roleId,
              updatedInChunk: chunk.length,
              runningUserGroupUpdated: userGroupUpdated,
              runningTotals: {
                processed: summary.processed,
                updated: summary.updated + userGroupUpdated,
                skipped: summary.skipped,
                errors: summary.errors,
              },
            });

            // Wait 1s after every chunk except the very last one of the run.
            // The last chunk has no following work, so the delay would only
            // prolong the request for no benefit.
            const isVeryLastChunk =
              ug === userGroups.length - 1 && isLastChunkOfUserGroup;
            if (!isVeryLastChunk && !options.dryRun) {
              await RoleFrameworkBackfillController.sleep(CHUNK_DELAY_MS);
            }
          }
        }

        summary.updated += userGroupUpdated;
        logger.info(`${TAG} userGroup ${userGroupNumber}/${userGroups.length} complete`, {
          runId,
          userGroupId: userGroup.id,
          mappingsUpdated: userGroupUpdated,
          chunkErrors: userGroupErrors,
          runningTotals: {
            processed: summary.processed,
            updated: summary.updated,
            skipped: summary.skipped,
            errors: summary.errors,
          },
        });
      } catch (error) {
        summary.errors += 1;
        logger.error(`${TAG} userGroup ${userGroupNumber} — error backfilling`, {
          runId,
          userGroupId: userGroup.id,
          workspaceId: userGroup.workspaceId,
          error: error,
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }

    logger.info(`${TAG} backfill end`, {
      runId,
      totalUserGroups: userGroups.length,
      summary,
    });

    return summary;
  }

  /**
   * Backfill three role-framework keys in `boards.metadata` per board:
   *
   * 1. `assignmentRoles`:
   *    - If `fullRoleAssignment === true` and `assignmentRoles` is missing/empty
   *      → set 4 slots [MANAGER, MEMBER (isPrimary), QA, PR_REVIEWER]. MEMBER
   *      is the primary slot (becomes `ticket.assignedTo`).
   *    - Else if `assignmentRoles` is missing/empty → set 1 slot
   *      [MEMBER (isPrimary)] so a minimal role-driven config exists.
   *    - Else (already populated) → SKIP.
   * 2. `ticketControlRoleIds`: set on boards where `isAllowedToTransfer === true`
   *    and `ticketControlRoleIds` is missing/empty. Adds `[MANAGER, TEAM_LEAD]`.
   * 3. `bitbucketEventRoles`: set on every board where it's missing. Sets
   *    `{ prOpenedRoleId: <PR_REVIEWER roleId>, prMergedRoleId: <QA roleId> }`.
   *
   * Processes boards in batches of 50 (one `board.update` per board, so up to
   * 50 writes per batch) with a 1-second delay between batches.
   */
  private static async backfillBoardMetadata(
    options: BackfillOptions,
    runId: string,
  ): Promise<BackfillSummary> {
    const TAG = '[RoleFrameworkBackfill][boardMetadata]';
    const summary: BackfillSummary = { processed: 0, updated: 0, skipped: 0, errors: 0 };
    const BATCH_SIZE = 50;
    const BATCH_DELAY_MS = 1000;

    logger.info(`${TAG} backfill start`, {
      runId,
      dryRun: options.dryRun,
      batchSize: BATCH_SIZE,
      batchDelayMs: BATCH_DELAY_MS,
    });

    const boards = await db.board.findMany({
      select: { id: true, name: true, workspaceId: true, metadata: true },
      orderBy: { id: 'asc' },
    });

    logger.info(`${TAG} fetched boards`, {
      runId,
      totalBoards: boards.length,
    });

    if (boards.length === 0) {
      logger.info(`${TAG} backfill end — no boards to process`, {
        runId,
        summary,
      });
      return summary;
    }

    const totalBatches = Math.ceil(boards.length / BATCH_SIZE);

    for (let i = 0; i < boards.length; i += BATCH_SIZE) {
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const batch = boards.slice(i, i + BATCH_SIZE);
      const batchStats = { updated: 0, skipped: 0, errored: 0 };

      logger.info(`${TAG} batch ${batchNumber}/${totalBatches} start`, {
        runId,
        batchNumber,
        totalBatches,
        boardRange: `${i + 1}-${Math.min(i + BATCH_SIZE, boards.length)} of ${boards.length}`,
        boardIds: batch.map(b => b.id),
      });

      for (let bi = 0; bi < batch.length; bi += 1) {
        const board = batch[bi];
        const boardNumber = i + bi + 1;

        summary.processed += 1;

        try {
          const metadata = (board.metadata as Record<string, unknown> | null) ?? {};
          const updatedMetadata: Record<string, unknown> = { ...metadata };
          let changed = false;

          let assignmentRolesDecision: string;

          const existingAssignmentRoles = Array.isArray(metadata.assignmentRoles)
            ? (metadata.assignmentRoles as unknown[])
            : null;
          const assignmentRolesEmpty =
            !existingAssignmentRoles || existingAssignmentRoles.length === 0;

          if (!assignmentRolesEmpty) {
            assignmentRolesDecision = 'SKIP (already populated)';
          } else if (metadata.fullRoleAssignment === true) {
            const managerRoleId = `${board.workspaceId}-ROLE-MANAGER`;
            const memberRoleId = `${board.workspaceId}-ROLE-MEMBER`;
            const qaRoleId = `${board.workspaceId}-ROLE-QA`;
            const prReviewerRoleId = `${board.workspaceId}-ROLE-PR_REVIEWER`;
            updatedMetadata.assignmentRoles = [
              { roleId: managerRoleId, isPrimary: false },
              { roleId: memberRoleId, isPrimary: true },
              { roleId: qaRoleId, isPrimary: false },
              { roleId: prReviewerRoleId, isPrimary: false },
            ];
            changed = true;
            assignmentRolesDecision = 'SET 4 slots (fullRoleAssignment=true)';
          } else {
            const memberRoleId = `${board.workspaceId}-ROLE-MEMBER`;
            updatedMetadata.assignmentRoles = [
              { roleId: memberRoleId, isPrimary: true },
            ];
            changed = true;
            assignmentRolesDecision = 'SET 1 slot MEMBER (fullRoleAssignment !== true)';
          }

          let ticketControlDecision: string;

          const existingTicketControlRoleIds = Array.isArray(metadata.ticketControlRoleIds)
            ? (metadata.ticketControlRoleIds as unknown[])
            : null;
          if (metadata.isAllowedToTransfer === true) {
            if (!existingTicketControlRoleIds || existingTicketControlRoleIds.length === 0) {
              const managerRoleId = `${board.workspaceId}-ROLE-MANAGER`;
              const teamLeadRoleId = `${board.workspaceId}-ROLE-TEAM_LEAD`;
              updatedMetadata.ticketControlRoleIds = [managerRoleId, teamLeadRoleId];
              changed = true;
              ticketControlDecision = 'SET (isAllowedToTransfer=true, was empty)';
            } else {
              ticketControlDecision = 'SKIP (already populated)';
            }
          } else {
            ticketControlDecision = 'SKIP (isAllowedToTransfer !== true)';
          }

          let bitbucketDecision: string;

          const existingBitbucketEventRoles =
            metadata.bitbucketEventRoles && typeof metadata.bitbucketEventRoles === 'object'
              ? (metadata.bitbucketEventRoles as Record<string, unknown>)
              : null;
          if (!existingBitbucketEventRoles) {
            const prReviewerRoleId = `${board.workspaceId}-ROLE-PR_REVIEWER`;
            const qaRoleId = `${board.workspaceId}-ROLE-QA`;
            updatedMetadata.bitbucketEventRoles = {
              prOpenedRoleId: prReviewerRoleId,
              prMergedRoleId: qaRoleId,
            };
            changed = true;
            bitbucketDecision = 'SET (was missing)';
          } else {
            bitbucketDecision = 'SKIP (already populated)';
          }

          if (!changed) {
            summary.skipped += 1;
            batchStats.skipped += 1;
            logger.info(`${TAG} board ${boardNumber}/${boards.length} — no changes`, {
              runId,
              boardId: board.id,
              boardName: board.name,
              workspaceId: board.workspaceId,
              decisions: {
                assignmentRoles: assignmentRolesDecision,
                ticketControlRoleIds: ticketControlDecision,
                bitbucketEventRoles: bitbucketDecision,
              },
            });
          } else {
            if (!options.dryRun) {
              await db.board.update({
                where: { id: board.id },
                data: { metadata: updatedMetadata as object },
              });
            }
            summary.updated += 1;
            batchStats.updated += 1;
            logger.info(`${TAG} board ${boardNumber}/${boards.length} — updated`, {
              runId,
              boardId: board.id,
              boardName: board.name,
              workspaceId: board.workspaceId,
              dryRun: options.dryRun,
              decisions: {
                assignmentRoles: assignmentRolesDecision,
                ticketControlRoleIds: ticketControlDecision,
                bitbucketEventRoles: bitbucketDecision,
              },
            });
          }
        } catch (error) {
          summary.errors += 1;
          batchStats.errored += 1;
          logger.error(`${TAG} board ${boardNumber}/${boards.length} — error`, {
            runId,
            boardId: board.id,
            boardName: board.name,
            workspaceId: board.workspaceId,
            error: error,
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
      }

      logger.info(`${TAG} batch ${batchNumber}/${totalBatches} complete`, {
        runId,
        batchNumber,
        totalBatches,
        boardsUpdated: batchStats.updated,
        boardsSkipped: batchStats.skipped,
        boardsErrored: batchStats.errored,
        runningTotals: {
          processed: summary.processed,
          updated: summary.updated,
          skipped: summary.skipped,
          errors: summary.errors,
        },
      });

      const isLastBatch = i + BATCH_SIZE >= boards.length;
      if (!isLastBatch && !options.dryRun) {
        await RoleFrameworkBackfillController.sleep(BATCH_DELAY_MS);
      }
    }

    logger.info(`${TAG} backfill end`, {
      runId,
      totalBoards: boards.length,
      summary,
    });

    return summary;
  }

  /**
   * Backfill `stage_approvers.approverType` from NULL to 'USER'.
   *
   * Existing rows written before the approverType column was added have NULL
   * in that column. The codebase treats NULL as USER everywhere, but the
   * column should be explicit so downstream queries don't have to special-case
   * NULL. Idempotent — only touches rows where approverType IS NULL.
   *
   * Fetches the ids of rows where approverType IS NULL in batches of 50, then
   * issues one `updateMany` per batch (50 rows per DB round-trip). Waits 1
   * second between batches.
   */
  private static async backfillStageApproversApproverType(
    options: BackfillOptions,
    runId: string,
  ): Promise<BackfillSummary> {
    const TAG = '[RoleFrameworkBackfill][stageApproversApproverType]';
    const summary: BackfillSummary = { processed: 0, updated: 0, skipped: 0, errors: 0 };
    const BATCH_SIZE = 50;
    const BATCH_DELAY_MS = 1000;

    logger.info(`${TAG} backfill start`, {
      runId,
      dryRun: options.dryRun,
      batchSize: BATCH_SIZE,
      batchDelayMs: BATCH_DELAY_MS,
    });

    const nullRows = await db.stageApprovers.findMany({
      where: { approverType: null },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    logger.info(`${TAG} fetched null approverType rows`, {
      runId,
      totalNullRows: nullRows.length,
    });

    if (nullRows.length === 0) {
      logger.info(`${TAG} backfill end — no rows to backfill`, {
        runId,
        summary,
      });
      return summary;
    }

    const totalBatches = Math.ceil(nullRows.length / BATCH_SIZE);

    for (let i = 0; i < nullRows.length; i += BATCH_SIZE) {
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const batchIds = nullRows.slice(i, i + BATCH_SIZE).map(r => r.id);

      logger.info(`${TAG} batch ${batchNumber}/${totalBatches} start`, {
        runId,
        batchNumber,
        totalBatches,
        rowRange: `${i + 1}-${Math.min(i + BATCH_SIZE, nullRows.length)} of ${nullRows.length}`,
        batchSize: batchIds.length,
      });

      summary.processed += batchIds.length;

      try {
        if (!options.dryRun) {
          const result = await db.stageApprovers.updateMany({
            where: { id: { in: batchIds }, approverType: null },
            data: { approverType: 'USER' },
          });
          summary.updated += result.count;
        } else {
          summary.updated += batchIds.length;
        }
      } catch (error) {
        summary.errors += 1;
        logger.error(`${TAG} batch ${batchNumber}/${totalBatches} — error`, {
          runId,
          batchNumber,
          batchSize: batchIds.length,
          firstRowId: batchIds[0],
          error: error,
          stack: error instanceof Error ? error.stack : undefined,
        });
      }

      logger.info(`${TAG} batch ${batchNumber}/${totalBatches} complete`, {
        runId,
        batchNumber,
        totalBatches,
        batchSize: batchIds.length,
        runningTotals: {
          processed: summary.processed,
          updated: summary.updated,
          skipped: summary.skipped,
          errors: summary.errors,
        },
      });

      const isLastBatch = i + BATCH_SIZE >= nullRows.length;
      if (!isLastBatch && !options.dryRun) {
        await RoleFrameworkBackfillController.sleep(BATCH_DELAY_MS);
      }
    }

    logger.info(`${TAG} backfill end`, {
      runId,
      totalNullRows: nullRows.length,
      summary,
    });

    return summary;
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>) {
    const runId = `rfb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const TAG = '[RoleFrameworkBackfill]';

    try {
      const mode = RoleFrameworkBackfillController.parseMode(req.body);
      if (!mode) {
        const response: ApiResponse = {
          success: false,
          error:
            'Invalid or missing `mode`. Must be one of: seedDefaultRoles, userGroupMappingsRoleId, boardMetadata, stageApproversApproverType',
          timestamp: new Date().toISOString(),
        };
        res.status(400).json(response);
        return;
      }

      const options = RoleFrameworkBackfillController.buildDefaultOptions(req.body);

      logger.info(`${TAG} backfill start`, {
        runId,
        mode,
        options,
      });

      let summary: BackfillSummary;
      switch (mode) {
        case 'seedDefaultRoles':
          summary = await RoleFrameworkBackfillController.seedDefaultRoles(options, runId);
          break;
        case 'userGroupMappingsRoleId':
          summary = await RoleFrameworkBackfillController.backfillUserGroupMappingsRoleId(options, runId);
          break;
        case 'boardMetadata':
          summary = await RoleFrameworkBackfillController.backfillBoardMetadata(options, runId);
          break;
        case 'stageApproversApproverType':
          summary = await RoleFrameworkBackfillController.backfillStageApproversApproverType(options, runId);
          break;
        default:
          // Future modes — not yet implemented.
          logger.warn(`${TAG} unsupported mode (not yet implemented)`, { runId, mode });
          const response: ApiResponse = {
            success: false,
            error: `Backfill mode '${mode}' is not yet implemented`,
            timestamp: new Date().toISOString(),
          };
          res.status(400).json(response);
          return;
      }

      logger.info(`${TAG} backfill end`, {
        runId,
        mode,
        summary,
      });

      const response: ApiResponse = {
        success: true,
        message: 'Backfill completed',
        data: {
          runId,
          mode,
          options,
          summary,
        },
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error(`${TAG} backfill failed`, {
        runId,
        error: error,
        stack: error instanceof Error ? error.stack : undefined,
      });
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run backfill',
        timestamp: new Date().toISOString(),
      };
      res.status(500).json(response);
    }
  }

  static async getBackfillStats(_req: Request, res: Response<ApiResponse>) {
    try {
      // seedDefaultRoles stats
      const totalWorkspaces = await db.workspace.count();
      const totalRoles = await db.role.count();
      const rolesWithDefaultNames = await db.role.count({
        where: { name: { in: [...DEFAULT_ROLE_NAMES] } },
      });

      const workspacesWithAllDefaults = await db.workspace.findMany({
        select: {
          id: true,
          _count: {
            select: {
              roles: { where: { name: { in: [...DEFAULT_ROLE_NAMES] } } },
            },
          },
        },
      });
      const workspacesNeedingSeed = workspacesWithAllDefaults.filter(
        w => w._count.roles < DEFAULT_ROLE_NAMES.length,
      ).length;

      // userGroupMappingsRoleId stats
      const totalUserGroupMappings = await db.userGroupMapping.count();
      const userGroupMappingsNeedingRoleId = await db.userGroupMapping.count({
        where: { roleId: null, responsibility: { not: null } },
      });

      // boardMetadata stats — count boards where each key is missing/empty
      const totalBoards = await db.board.count();
      const boards = await db.board.findMany({
        select: { metadata: true },
      });
      let boardsNeedingAssignmentRoles = 0;
      let boardsNeedingTicketControlRoleIds = 0;
      let boardsNeedingBitbucketEventRoles = 0;
      for (const b of boards) {
        const md = (b.metadata as Record<string, unknown> | null) ?? {};
        const ar = Array.isArray(md.assignmentRoles) ? (md.assignmentRoles as unknown[]) : null;
        if (!ar || ar.length === 0) boardsNeedingAssignmentRoles += 1;
        const tc = Array.isArray(md.ticketControlRoleIds) ? (md.ticketControlRoleIds as unknown[]) : null;
        if (!tc || tc.length === 0) boardsNeedingTicketControlRoleIds += 1;
        if (!md.bitbucketEventRoles || typeof md.bitbucketEventRoles !== 'object') {
          boardsNeedingBitbucketEventRoles += 1;
        }
      }

      // stageApproversApproverType stats
      const totalStageApprovers = await db.stageApprovers.count();
      const stageApproversNeedingApproverType = await db.stageApprovers.count({
        where: { approverType: null },
      });

      const response: ApiResponse = {
        success: true,
        data: {
          stats: {
            seedDefaultRoles: {
              totalWorkspaces,
              totalRoles,
              rolesWithDefaultNames,
              workspacesNeedingSeed: workspacesNeedingSeed,
            },
            userGroupMappingsRoleId: {
              totalUserGroupMappings,
              userGroupMappingsNeedingRoleId,
            },
            boardMetadata: {
              totalBoards,
              boardsNeedingAssignmentRoles,
              boardsNeedingTicketControlRoleIds,
              boardsNeedingBitbucketEventRoles,
            },
            stageApproversApproverType: {
              totalStageApprovers,
              stageApproversNeedingApproverType,
            },
          },
        },
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('[RoleFrameworkBackfill] Error getting stats:', error);
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get stats',
        timestamp: new Date().toISOString(),
      };
      res.status(500).json(response);
    }
  }
}
