import type { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import type { Prisma } from '@prisma/client';
import { updateDeskThreadCanvasMetadata } from '@/bypassAcl/deskThreadCanvasServices';
import { convertMarkdownToBlockNote } from '@/services/canvasService';
import { readFromYSweetStrict, syncToYSweet } from '@/utils/ysweetUtils';
import { paragraphBlocks, type CanvasMetadata } from '@/services/deskThreadCanvasService';

const FALLBACK_AUTHOR = 'desk-thread-canvas';
const FAILURE_REASON = 'Unexpected persistence failure';

/** Replaces the "Generating canvas from thread…" placeholder seeded at dispatch. */
const buildFailureBlocks = (reason: string) =>
  paragraphBlocks(`Couldn't generate this canvas from the ticket thread: ${reason}`);

// The agent is asked for {"markdown": "..."} but may wrap it in a fence. Sliced,
// not matched: the obvious fence regex backtracks quadratically on agent-
// controlled input (CodeQL polynomial-ReDoS).
function stripJsonFence(text: string): string {
  if (text.length < 6 || !text.startsWith('```') || !text.endsWith('```')) return text;
  return text.slice(3, -3).replace(/^json/i, '').trim();
}

function extractMarkdown(payload: Record<string, unknown>): string | null {
  const result = payload['result'];
  if (typeof result !== 'string' || !result.trim()) return null;
  const text = result.trim();
  try {
    const parsed: unknown = JSON.parse(stripJsonFence(text));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const markdown = (parsed as Record<string, unknown>)['markdown'];
      if (typeof markdown === 'string' && markdown.trim()) return markdown;
      // A JSON object with no markdown is a structured failure, not content.
      return null;
    }
  } catch {
    // Not JSON — fall through and treat the whole result as markdown.
  }
  return text;
}

/** Terminal callback for a dispatched canvas generation. Mirrors
 *  handleDeskReportCallback: claw always gets a 200 once the run's fate is
 *  recorded, so it never retries a deterministic failure. */
export async function handleDeskThreadCanvasCallback(
  req: Request<{ canvasId: string; sessionId: string }>,
  res: Response,
): Promise<void> {
  const { canvasId, sessionId } = req.params;
  const payload = (req.body ?? {}) as Record<string, unknown>;
  const status = typeof payload['status'] === 'string' ? payload['status'] : undefined;

  logger.info('[DeskThreadCanvas] callback received', { canvasId, sessionId, status });

  // Hoisted: the catch block marks the run FAILED with these.
  let metadata: CanvasMetadata = {};
  let workspaceId = '';
  let author = FALLBACK_AUTHOR;

  const setMetadata = (patch: Partial<CanvasMetadata>) =>
    updateDeskThreadCanvasMetadata(workspaceId, canvasId, { ...metadata, ...patch } as Prisma.InputJsonValue);

  // The canvas body is the only place the waiting user is looking, and it
  // still reads "Generating canvas from thread…" — overwrite it, or the run
  // looks stuck forever. Metadata keeps the reason for support.
  const fail = async (reason: string): Promise<void> => {
    try {
      await setMetadata({ generationStatus: 'FAILED', error: reason });
    } finally {
      if (!metadata.hasContent) await syncToYSweet(canvasId, buildFailureBlocks(reason), author);
    }
  };

  try {
    const canvas = await db.canvas.findUnique({ where: { id: canvasId } });
    metadata = (canvas?.metadata as CanvasMetadata | null) ?? {};
    workspaceId = canvas?.workspaceId ?? '';
    author = canvas?.createdBy || FALLBACK_AUTHOR;

    // Stale/dropped-run guard: only this run's sessionId may write.
    if (!canvas || metadata.sessionId !== sessionId) {
      logger.warn('[DeskThreadCanvas] callback: no matching session — dropping', {
        canvasId,
        sessionId,
        expected: metadata.sessionId,
      });
      res.json({ success: true, persisted: false });
      return;
    }

    const errorMessage = typeof payload['error'] === 'string' ? payload['error'] : undefined;
    // claw sends "completed" | "failed" | "cancelled" (xyne-claw sendCallback).
    const failed = (status !== undefined && status !== 'completed') || !!errorMessage;
    const markdown = failed ? null : extractMarkdown(payload);

    if (!markdown) {
      logger.warn('[DeskThreadCanvas] callback: no markdown produced — marking failed', {
        canvasId,
        sessionId,
        status,
        error: errorMessage,
      });
      // claw tags a blank run (`emptyReason`) and a non-completed one (`status`).
      const emptyReason = typeof payload['emptyReason'] === 'string' ? payload['emptyReason'] : undefined;
      await fail(
        errorMessage ??
          (failed ? `Agent run ${status}` : `The agent returned no canvas content${emptyReason ? ` (${emptyReason})` : ''}`),
      );
      res.json({ success: true, persisted: false });
      return;
    }

    // Read before writing, as canvasController does: syncToYSweet clears the
    // document, so a regenerate would lose a whiteboard drawn on the canvas.
    // Strict, as canvasController.updateCanvas: a failed read taken as "empty"
    // would restore nothing and the whiteboard would be lost. A throw lands in
    // the catch below, which marks the run FAILED.
    const existingBlocks = await readFromYSweetStrict(canvasId, author);
    const blocks = await convertMarkdownToBlockNote(markdown, existingBlocks);
    if (blocks.length === 0) {
      await fail('Markdown produced no blocks');
      res.json({ success: true, persisted: false });
      return;
    }

    const synced = await syncToYSweet(canvasId, blocks, author);
    if (!synced) {
      logger.error('[DeskThreadCanvas] callback: Y-Sweet sync failed', { canvasId, sessionId });
      await fail('Failed to sync canvas content');
      res.json({ success: true, persisted: false });
      return;
    }

    await setMetadata({ generationStatus: 'READY', error: undefined, hasContent: true });
    logger.info('[DeskThreadCanvas] callback: canvas persisted', { canvasId, sessionId });
    res.json({ success: true, persisted: true });
  } catch (err) {
    logger.error('[DeskThreadCanvas] callback failed', { canvasId, sessionId, error: err });
    // Mark FAILED and 200 — the fate is decided; a 500 would invite claw to retry
    // a deterministic failure (mirrors desk-report's accepted-fate semantics).
    try {
      // Canvas never loaded (or its session wasn't verified) — fail() would
      // overwrite a READY body with the failure text.
      if (workspaceId) await fail(FAILURE_REASON);
    } catch (markErr) {
      logger.error('[DeskThreadCanvas] failed even to mark FAILED', { canvasId, error: markErr });
    }
    res.json({ success: true, persisted: false });
  }
}
