import type { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { runAsServiceActor } from '@/database/tenant/context';
import { convertMarkdownToBlockNote } from '@/services/canvasService';
import { readFromYSweet, syncToYSweet } from '@/utils/ysweetUtils';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import type { CanvasMetadata } from '@/services/deskThreadCanvasService';
import { randomUUID } from 'crypto';

const FALLBACK_AUTHOR = 'desk-thread-canvas';

/** Replaces the "Generating canvas from thread…" placeholder seeded at dispatch. */
function buildFailureBlocks(reason: string): BlockNoteBlock[] {
  return [
    {
      id: randomUUID(),
      type: 'paragraph',
      props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
      content: [
        {
          type: 'text',
          text: `Couldn't generate this canvas from the ticket thread: ${reason}`,
          styles: {},
        },
      ],
      children: [],
    } as BlockNoteBlock,
  ];
}

// Mirrors automations/steps/run-agent.step.ts stripJsonFence/parseAgentJson —
// the agent is asked for {"markdown": "..."} but may wrap it in a fence.
function stripJsonFence(text: string): string {
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  return fence?.[1]?.trim() ?? text;
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

  try {
    const canvas = await db.canvas.findUnique({ where: { id: canvasId } });
    metadata = (canvas?.metadata as CanvasMetadata | null) ?? {};
    workspaceId = canvas?.workspaceId ?? '';

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

    const runScoped = <T>(fn: () => Promise<T>): Promise<T> =>
      runAsServiceActor('desk-thread-canvas-callback', workspaceId, fn);

    const setMetadata = (patch: Partial<CanvasMetadata>) =>
      runScoped(() =>
        db.canvas.update({
          where: { id: canvasId },
          data: { metadata: { ...metadata, ...patch }, lastEditedAt: new Date() },
        }),
      );

    // The canvas body is the only place the waiting user is looking, and it
    // still reads "Generating canvas from thread…" — overwrite it, or the run
    // looks stuck forever. Metadata keeps the reason for support.
    const fail = async (reason: string): Promise<void> => {
      await setMetadata({ generationStatus: 'FAILED', error: reason });
      await syncToYSweet(canvasId, buildFailureBlocks(reason), canvas.createdBy || FALLBACK_AUTHOR);
    };

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
      await fail(errorMessage ?? 'No canvas content produced');
      res.json({ success: true, persisted: false });
      return;
    }

    // Read before writing, as canvasController does: syncToYSweet clears the
    // document, so a regenerate would lose a whiteboard drawn on the canvas.
    const author = canvas.createdBy || FALLBACK_AUTHOR;
    const existingBlocks = await readFromYSweet(canvasId, author).catch(() => []);
    const blocks = await convertMarkdownToBlockNote(markdown, existingBlocks);
    if (blocks.length === 0) {
      await fail('Markdown produced no blocks');
      res.json({ success: true, persisted: false });
      return;
    }

    const synced = await syncToYSweet(canvasId, blocks, author);
    if (!synced) {
      logger.error('[DeskThreadCanvas] callback: Y-Sweet sync failed', { canvasId, sessionId });
      await setMetadata({ generationStatus: 'FAILED', error: 'Failed to sync canvas content' });
      res.json({ success: true, persisted: false });
      return;
    }

    await setMetadata({ generationStatus: 'READY', error: undefined });
    logger.info('[DeskThreadCanvas] callback: canvas persisted', { canvasId, sessionId });
    res.json({ success: true, persisted: true });
  } catch (err) {
    logger.error('[DeskThreadCanvas] callback failed', { canvasId, sessionId, error: err });
    // Mark FAILED and 200 — the fate is decided; a 500 would invite claw to retry
    // a deterministic failure (mirrors desk-report's accepted-fate semantics).
    try {
      await runAsServiceActor('desk-thread-canvas-callback', workspaceId, () =>
        db.canvas.update({
          where: { id: canvasId },
          data: { metadata: { ...metadata, generationStatus: 'FAILED', error: 'Unexpected persistence failure' } },
        }),
      );
    } catch (markErr) {
      logger.error('[DeskThreadCanvas] failed even to mark FAILED', { canvasId, error: markErr });
    }
    res.json({ success: true, persisted: false });
  }
}
