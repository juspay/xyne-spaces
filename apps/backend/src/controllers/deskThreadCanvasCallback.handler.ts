import type { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { convertMarkdownToBlockNote } from '@/services/canvasService';
import { readFromYSweet, readFromYSweetStrict, syncToYSweet } from '@/utils/ysweetUtils';
import { GENERATING_TEXT, paragraphBlocks } from '@/services/deskThreadCanvasService';

const FAILURE_REASON = 'Unexpected persistence failure';

/** Still the seeded placeholder (or never seeded): nothing a run wrote or a person edited. */
const isUnfilled = (blocks: unknown[]): boolean =>
  blocks.length === 0 || JSON.stringify(blocks).includes(GENERATING_TEXT);

/** A failure whose message is safe to show in the canvas body. */
class CanvasFailure extends Error {}

/** Terminal callback for a dispatched canvas generation. Mirrors
 *  handleDeskReportCallback: claw always gets a 200 once the run's fate is
 *  recorded, so it never retries a deterministic failure. */
export async function handleDeskThreadCanvasCallback(
  req: Request<{ canvasId: string }>,
  res: Response
): Promise<void> {
  const { canvasId } = req.params;
  const payload = (req.body ?? {}) as Record<string, unknown>;
  const status = typeof payload['status'] === 'string' ? payload['status'] : undefined;

  logger.info('[DeskThreadCanvas] callback received', { canvasId, status });

  // Hoisted: the catch block writes the failure notice as this author.
  let author: string | null = null;

  // The canvas body still reads "Generating canvas from thread…" — overwrite
  // it, or the run looks stuck forever. Only while it still does: a duplicate
  // or late callback must not clobber content a run or a person already wrote.
  const fail = async (reason: string): Promise<void> => {
    if (!author) return;
    const body = await readFromYSweet(canvasId, author);
    if (!isUnfilled(body)) return;
    await syncToYSweet(
      canvasId,
      paragraphBlocks(`Couldn't generate this canvas from the ticket thread: ${reason}`),
      author
    );
  };

  try {
    const canvas = await db.canvas.findUnique({
      where: { id: canvasId },
      select: { createdBy: true },
    });
    if (!canvas) {
      logger.warn('[DeskThreadCanvas] callback: canvas not found — dropping', { canvasId });
      res.json({ success: true, persisted: false });
      return;
    }
    author = canvas.createdBy;

    const errorMessage = typeof payload['error'] === 'string' ? payload['error'] : undefined;
    // claw sends "completed" | "failed" | "cancelled" (xyne-claw sendCallback).
    const failed = (status !== undefined && status !== 'completed') || !!errorMessage;
    const result = payload['result'];
    const markdown = !failed && typeof result === 'string' && result.trim() ? result.trim() : null;
    if (!markdown) {
      throw new CanvasFailure(
        errorMessage ?? (failed ? `Agent run ${status}` : 'The agent returned no canvas content')
      );
    }

    // Strict read so a failed one can't wipe a whiteboard, as canvasController.updateCanvas.
    const existingBlocks = await readFromYSweetStrict(canvasId, author);
    if (!isUnfilled(existingBlocks)) {
      logger.warn('[DeskThreadCanvas] callback: canvas already has content — dropping', {
        canvasId,
      });
      res.json({ success: true, persisted: false });
      return;
    }
    const blocks = await convertMarkdownToBlockNote(markdown, existingBlocks);
    if (blocks.length === 0) throw new CanvasFailure('Markdown produced no blocks');
    if (!(await syncToYSweet(canvasId, blocks, author))) {
      throw new CanvasFailure('Failed to sync canvas content');
    }

    logger.info('[DeskThreadCanvas] callback: canvas persisted', { canvasId });
    res.json({ success: true, persisted: true });
  } catch (err) {
    logger.warn('[DeskThreadCanvas] callback: marking failed', { canvasId, status, error: err });
    // Mark failed and 200 — the fate is decided; a 500 would invite claw to retry
    // a deterministic failure (mirrors desk-report's accepted-fate semantics).
    try {
      await fail(err instanceof CanvasFailure ? err.message : FAILURE_REASON);
    } catch (markErr) {
      logger.error('[DeskThreadCanvas] failed even to mark FAILED', { canvasId, error: markErr });
    }
    res.json({ success: true, persisted: false });
  }
}
