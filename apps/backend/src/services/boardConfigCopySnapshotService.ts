import { once } from 'node:events';
import { createGzip } from 'node:zlib';
import { FormContextType } from '@xyne/shared';
import { db } from '@/database/client';
import { storageService } from '@/services/storage';
import { logger } from '@/utils/logger';

const TAG = '[BoardConfigCopySnapshot]';

/**
 * Object-storage prefix every snapshot lives under. Kept as a single top-level folder so
 * a bucket lifecycle rule can target it with one `matchesPrefix` condition.
 */
export const SNAPSHOT_PREFIX = 'board-config-copy-snapshots';

/** Snapshots are a short-lived undo buffer for a destructive admin action, not an archive. */
export const SNAPSHOT_RETENTION_DAYS = 7;

const SNAPSHOT_FORMAT_VERSION = 1;
const TICKET_BATCH_SIZE = 1000;

interface CaptureSnapshotParams {
  targetBoardId: string;
  sourceBoardId: string;
  workspaceId: string;
  actorUserId: string;
}

export interface BoardSnapshotResult {
  path: string;
  sizeBytes: number;
  ticketCount: number;
}

/**
 * Captures the pre-copy state of a board so a bad copy can be reconstructed by hand.
 *
 * Written as gzipped NDJSON — one JSON record per line, each tagged with a `type` — so the
 * writer never has to hold the whole document in memory and a reader can stream it back
 * record by record. Only compressed bytes accumulate in memory; rows are read in batches.
 */
class BoardConfigCopySnapshotService {
  async captureSnapshot(params: CaptureSnapshotParams): Promise<BoardSnapshotResult> {
    const { targetBoardId, sourceBoardId, workspaceId, actorUserId } = params;
    const startedAt = new Date();

    const gzip = createGzip();
    const compressed: Buffer[] = [];
    gzip.on('data', (chunk: Buffer) => compressed.push(chunk));
    const gzipFinished = new Promise<void>((resolve, reject) => {
      gzip.on('end', resolve);
      gzip.on('error', reject);
    });

    const writeRecord = async (type: string, data: unknown): Promise<void> => {
      if (!gzip.write(`${JSON.stringify({ type, data })}\n`)) {
        await once(gzip, 'drain');
      }
    };

    const stages = await db.stage.findMany({ where: { boardId: targetBoardId } });
    const stageIds = stages.map(s => s.id);
    const transitions = await db.stageTransition.findMany({ where: { boardId: targetBoardId } });
    const transitionIds = transitions.map(t => t.id);

    let ticketCount = 0;

    try {
      await writeRecord('meta', {
        formatVersion: SNAPSHOT_FORMAT_VERSION,
        takenAt: startedAt.toISOString(),
        targetBoardId,
        sourceBoardId,
        workspaceId,
        actorUserId,
      });

      const board = await db.board.findUnique({ where: { id: targetBoardId } });
      if (board) await writeRecord('board', board);

      for (const stage of stages) await writeRecord('stage', stage);
      for (const transition of transitions) await writeRecord('stageTransition', transition);

      // Approvers hang off either a stage or a transition, and the copy deletes both kinds.
      const approverFilters = [
        ...(stageIds.length > 0 ? [{ stageId: { in: stageIds } }] : []),
        ...(transitionIds.length > 0 ? [{ transitionId: { in: transitionIds } }] : []),
      ];
      if (approverFilters.length > 0) {
        const approvers = await db.stageApprovers.findMany({ where: { OR: approverFilters } });
        for (const approver of approvers) await writeRecord('stageApprover', approver);
      }

      if (stageIds.length > 0) {
        const prMappings = await db.stagePRStatusMapping.findMany({ where: { stageId: { in: stageIds } } });
        for (const mapping of prMappings) await writeRecord('stagePRStatusMapping', mapping);
      }

      // Both the board-level ticket form binding (replaced by the customFields category)
      // and the per-stage form bindings (dropped with their stages).
      const formMappings = await db.formContextMapping.findMany({
        where: {
          OR: [
            { contextId: targetBoardId, contextType: FormContextType.BOARD },
            ...(stageIds.length > 0 ? [{ contextId: { in: stageIds }, contextType: FormContextType.STAGE }] : []),
          ],
        },
      });
      for (const mapping of formMappings) await writeRecord('formContextMapping', mapping);

      // Tickets are captured on every run, not only when the stages category is selected.
      // The snapshot is the sole undo path for a destructive admin action, so it records
      // the whole board rather than guessing which parts this particular run will touch.
      ticketCount = await this.writeTickets(targetBoardId, writeRecord);
      if (stageIds.length > 0) await this.writeTicketStageEtas(stageIds, writeRecord);

      gzip.end();
      await gzipFinished;
    } catch (error) {
      gzip.destroy();
      throw error;
    }

    const buffer = Buffer.concat(compressed);
    const path = `${SNAPSHOT_PREFIX}/${workspaceId}/${targetBoardId}/${startedAt.toISOString().replace(/[:.]/g, '-')}.ndjson.gz`;

    await storageService.uploadFileV2(buffer, { path, contentType: 'application/gzip' });

    logger.info(`${TAG} Wrote snapshot for board ${targetBoardId}`, {
      path,
      sizeBytes: buffer.length,
      ticketCount,
      stageCount: stages.length,
    });

    return { path, sizeBytes: buffer.length, ticketCount };
  }

  /** Only the columns the copy actually rewrites, plus enough identity to match rows back up. */
  private async writeTickets(
    targetBoardId: string,
    writeRecord: (type: string, data: unknown) => Promise<void>,
  ): Promise<number> {
    let cursor: string | null = null;
    let count = 0;

    for (;;) {
      const tickets = await this.fetchTicketBatch(targetBoardId, cursor);
      if (tickets.length === 0) break;

      for (const ticket of tickets) await writeRecord('ticket', ticket);
      count += tickets.length;

      const nextCursor = tickets[tickets.length - 1]?.id ?? null;
      if (!nextCursor) break;
      cursor = nextCursor;
    }

    return count;
  }

  // Split out of the paging loop so the cursor is a plain parameter — inferring the row
  // type inline would make it depend on a variable the loop body assigns from it.
  private fetchTicketBatch(targetBoardId: string, after: string | null) {
    return db.ticket.findMany({
      where: { boardId: targetBoardId, ...(after ? { id: { gt: after } } : {}) },
      select: {
        id: true,
        xyneId: true,
        boardId: true,
        stageName: true,
        statusV2: true,
        statusUpdatedAt: true,
        eta: true,
        updatedAt: true,
        updatedBy: true,
      },
      orderBy: { id: 'asc' },
      take: TICKET_BATCH_SIZE,
    });
  }

  /** The per-stage-visit SLA ledger rows that the remap closes out or rewrites. */
  private async writeTicketStageEtas(
    stageIds: string[],
    writeRecord: (type: string, data: unknown) => Promise<void>,
  ): Promise<void> {
    let cursor: string | null = null;

    for (;;) {
      const rows = await this.fetchTicketStageEtaBatch(stageIds, cursor);
      if (rows.length === 0) break;

      for (const row of rows) await writeRecord('ticketStageEta', row);

      const nextCursor = rows[rows.length - 1]?.id ?? null;
      if (!nextCursor) break;
      cursor = nextCursor;
    }
  }

  private fetchTicketStageEtaBatch(stageIds: string[], after: string | null) {
    return db.ticketStageEta.findMany({
      where: { stageId: { in: stageIds }, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: 'asc' },
      take: TICKET_BATCH_SIZE,
    });
  }

  /**
   * Deletes snapshots past the retention window. Best-effort and non-fatal: this is a
   * convenience so the prefix doesn't grow without bound in environments where no bucket
   * lifecycle rule has been configured. Where one exists it does the same job on a
   * guaranteed schedule and this simply finds nothing to remove.
   */
  async sweepExpiredSnapshots(): Promise<void> {
    try {
      const cutoff = Date.now() - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      const files = await storageService.listFiles(`${SNAPSHOT_PREFIX}/`);

      for (const file of files) {
        if (!file.updated || file.updated.getTime() >= cutoff) continue;
        await storageService.deleteFile(file.name);
        logger.info(`${TAG} Removed expired snapshot ${file.name}`);
      }
    } catch (error) {
      logger.warn(`${TAG} Failed to sweep expired snapshots`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const boardConfigCopySnapshotService = new BoardConfigCopySnapshotService();
