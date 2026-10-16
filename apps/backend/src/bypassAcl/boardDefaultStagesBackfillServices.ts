import { BoardType } from '@xyne/shared';
import { db } from '@/database/client';
import { DEFAULT_BOARD_STAGES } from '@/constants/defaultBoardStages';
import { EntitySequenceService } from '@/services/entitySequenceService';
import { logger } from '@/utils/logger';
import { asSystem, transaction } from './base';

export type BoardDefaultStagesBackfillOptions = {
  batchSize: number;
  delayMs: number;
  dryRun: boolean;
  /** Restrict the run to these boards (e.g. to fix one reported board first). */
  boardIds?: string[];
};

export type BoardDefaultStagesBackfillSummary = {
  scanned: number;
  stageless: number;
  seeded: number;
  /** Stage-less boards whose type has its own stage template (RELEASE / FLOW). */
  skippedType: number;
  /** Boards that gained stages between the scan and the write. */
  skippedRace: number;
  failed: number;
  boards: Array<{ id: string; name: string; boardType: string; createdAt: Date; action: string }>;
};

/** Boards these defaults are valid for; RELEASE and FLOW boards use their own stage sets. */
const BACKFILLABLE_TYPES: string[] = [BoardType.DEFAULT, BoardType.NON_LINEAR];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One-off repair for boards that have zero stages. Ticket creation on such a board fails
 * (`BoardHasNoStagesError`) because a ticket must start in a stage. These boards come from
 * the dashboard's two-step "Create board" wizard being abandoned after step 1, from API
 * callers that created a board without stages, and from older data — POST /boards now seeds
 * DEFAULT_BOARD_STAGES itself, so no new ones should appear.
 *
 * For each stage-less DEFAULT / NON_LINEAR board, inserts DEFAULT_BOARD_STAGES. Sequence
 * numbers are allocated through EntitySequenceService (like the board.update mutator), so the
 * common-DB counter stays ahead of the rows and a stage added later can't reuse a number.
 * Idempotent: the insert re-checks inside a transaction that the board still has no stages,
 * so re-running, or racing a user who is saving stages, never adds a second set.
 *
 * Spans every workspace, so it runs under asSystem. Not called from this (public) repo: the
 * admin controller and route live in xyne-spaces-private
 * (controllers/boardDefaultStagesBackfillController.ts), which imports this bypass primitive
 * per the repo-coupling rule that no bypass logic may live in the private tree itself.
 */
export function runBoardDefaultStagesBackfillAsSystem(
  options: BoardDefaultStagesBackfillOptions
): Promise<BoardDefaultStagesBackfillSummary> {
  return asSystem(
    ['Board', 'Stage'],
    'one-off seeding of default stages on stage-less boards spans every workspace',
    async () => {
      const summary: BoardDefaultStagesBackfillSummary = {
        scanned: 0,
        stageless: 0,
        seeded: 0,
        skippedType: 0,
        skippedRace: 0,
        failed: 0,
        boards: [],
      };
      const startTime = Date.now();
      logger.info('[BoardDefaultStagesBackfill] Starting', options);

      let cursor: string | null = null;
      while (true) {
        const page: Array<{
          id: string;
          name: string;
          boardType: string;
          workspaceId: string;
          createdBy: string;
          createdAt: Date;
          _count: { stages: number };
        }> = await db.board.findMany({
          // AND, not a spread: both conditions are on `id`, and spreading the cursor would
          // overwrite the boardIds filter from the second page on.
          where: {
            AND: [
              ...(options.boardIds?.length ? [{ id: { in: options.boardIds } }] : []),
              ...(cursor ? [{ id: { gt: cursor } }] : []),
            ],
          },
          select: {
            id: true,
            name: true,
            boardType: true,
            workspaceId: true,
            createdBy: true,
            createdAt: true,
            _count: { select: { stages: true } },
          },
          orderBy: { id: 'asc' },
          take: options.batchSize,
        });
        if (page.length === 0) break;
        summary.scanned += page.length;

        for (const board of page) {
          if (board._count.stages > 0) continue;
          summary.stageless += 1;
          const report = {
            id: board.id,
            name: board.name,
            boardType: board.boardType,
            createdAt: board.createdAt,
            action: '',
          };
          summary.boards.push(report);

          if (!BACKFILLABLE_TYPES.includes(board.boardType)) {
            summary.skippedType += 1;
            report.action = 'skipped: board type has its own stage template';
            continue;
          }
          if (options.dryRun) {
            report.action = 'would seed default stages';
            continue;
          }

          try {
            // Allocate before the transaction: the common DB is a separate database, and an
            // unused number after a skipped write is only a gap, which the counter allows.
            const sequenceNumbers: number[] = [];
            let currentMax = 0;
            for (let i = 0; i < DEFAULT_BOARD_STAGES.length; i++) {
              const next = await EntitySequenceService.getNextBoardStageSequence(
                board.id,
                currentMax
              );
              sequenceNumbers.push(next);
              currentMax = Math.max(currentMax, next);
            }

            const inserted = await transaction(
              ['Stage'],
              'board default-stages backfill: re-check the board is still stage-less and insert its stages atomically',
              db,
              async (tx) => {
                const existing = await tx.stage.count({ where: { boardId: board.id } });
                if (existing > 0) return false;
                await tx.stage.createMany({
                  data: DEFAULT_BOARD_STAGES.map((stage, index) => ({
                    name: stage.name,
                    eta: 0,
                    sequenceNumber: sequenceNumbers[index]!,
                    defaultTicketStatusV2: stage.defaultTicketStatusV2,
                    boardId: board.id,
                    workspaceId: board.workspaceId,
                    createdBy: board.createdBy,
                  })),
                });
                return true;
              }
            );

            if (inserted) {
              summary.seeded += 1;
              report.action = 'seeded default stages';
            } else {
              summary.skippedRace += 1;
              report.action = 'skipped: board gained stages during the run';
            }
          } catch (error) {
            summary.failed += 1;
            report.action = `failed: ${error instanceof Error ? error.message : String(error)}`;
            logger.error('[BoardDefaultStagesBackfill] Board failed', { boardId: board.id, error });
          }
        }

        cursor = page[page.length - 1]?.id ?? null;
        logger.info('[BoardDefaultStagesBackfill] Batch done', {
          batchRows: page.length,
          scanned: summary.scanned,
          stageless: summary.stageless,
          seeded: summary.seeded,
        });
        if (page.length < options.batchSize) break;
        await sleep(options.delayMs);
      }

      const { boards, ...counts } = summary;
      logger.info('[BoardDefaultStagesBackfill] Done', {
        ...counts,
        boards,
        dryRun: options.dryRun,
        durationMs: Date.now() - startTime,
      });
      return summary;
    }
  );
}
