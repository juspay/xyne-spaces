import type { Call, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { CanvasRole } from '@xyne/shared';
import { db } from '@/database/client';
import { resolveCanvasConnectId } from '@/database/connectGroup';
import { repositories } from '@/database/repositories';
import { canvasAuthService } from '@/services/canvasAuthService';
import { convertBlockNoteToMarkdown } from '@/services/canvasService';
import { acquireLock, releaseLock } from '@/utils/distributedLock';
import { readFromYSweet } from '@/utils/ysweetUtils.js';
import { logger } from '@/utils/logger';

const NOTES_CANVAS_KEY = 'notesCanvasId';
// Keeps a long-running series' notes from crowding out the transcript in the summary prompt.
const MAX_NOTES_CONTEXT_CHARS = 20_000;

type NotesCall = Pick<Call, 'id' | 'recurringSeriesId'>;

function toMetadataObject(metadata: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

/**
 * Collaborative notes canvas for live calls. A recurring series shares one canvas
 * across every occurrence (id on RecurringCallSeries.metadata); any other call owns
 * its own (id on Call.metadata, the same key recordings use).
 */
class CallNotesCanvasService {
  /** Metadata of the record that owns the notes canvas: the series, or the call itself. */
  private async loadOwnerMetadata(call: NotesCall): Promise<Record<string, unknown>> {
    const owner = call.recurringSeriesId
      ? await repositories.recurringCallSeries.findById(call.recurringSeriesId)
      : await repositories.calls.findById(call.id);
    return toMetadataObject(owner?.metadata);
  }

  async resolveNotesCanvasId(call: NotesCall): Promise<string | null> {
    const canvasId = (await this.loadOwnerMetadata(call))[NOTES_CANVAS_KEY];
    return typeof canvasId === 'string' && canvasId ? canvasId : null;
  }

  async getOrCreate(
    call: NotesCall & Pick<Call, 'externalId' | 'workspaceId' | 'channelId' | 'title'>,
    userId: string,
  ): Promise<string> {
    // Serialize get-or-create so participants opening Notes at the same time share one canvas.
    const lockKey = `call-notes-canvas:${call.recurringSeriesId ?? call.id}`;

    const lock = await acquireLock(lockKey, { ttlSeconds: 30, waitTimeoutMs: 10_000, retryDelayMs: 100 });
    if (!lock) throw new Error(`Timed out waiting for notes canvas lock: ${lockKey}`);

    let canvasId: string;
    try {
      const metadata = await this.loadOwnerMetadata(call);
      const existing = metadata[NOTES_CANVAS_KEY];
      if (typeof existing === 'string' && existing) {
        canvasId = existing;
      } else {
        canvasId = uuidv4();
        await canvasAuthService.createCanvasForUser(canvasId, userId, {
          title: call.title ? `Notes: ${call.title}` : 'Call Notes',
          metadata: {
            source: 'call_notes',
            callId: call.externalId,
            ...(call.recurringSeriesId && { recurringSeriesId: call.recurringSeriesId }),
          },
        });

        const nextMetadata = { ...metadata, [NOTES_CANVAS_KEY]: canvasId };
        if (call.recurringSeriesId) {
          await repositories.recurringCallSeries.update(call.recurringSeriesId, { metadata: nextMetadata });
        } else {
          await repositories.calls.update(call.id, { metadata: nextMetadata });
        }
      }
    } finally {
      await releaseLock(lock);
    }

    // Slack Connect: stamp these EDITOR rows with the canvas's connectId (this write site is not
    // covered by a canvas create-site stamp). Without it, both rows are NULL and vanish once
    // connect_query_enabled_canvas flips on (queries.canvasParticipants → where('connectId')),
    // dropping the channel-wide edit grant. NULL when the canvas predates backfill (matches the
    // canvas row, which also still queries by canvasId).
    const canvasConnectId = await resolveCanvasConnectId(db, canvasId);

    // Channel members edit through the channel share; invitees outside the channel get a direct share.
    await db.canvasParticipant.createMany({
      data: [
        { id: uuidv4(), canvasId, connectId: canvasConnectId, workspaceId: call.workspaceId, userId, role: CanvasRole.EDITOR },
        ...(call.channelId
          ? [{ id: uuidv4(), canvasId, connectId: canvasConnectId, workspaceId: call.workspaceId, channelId: call.channelId, role: CanvasRole.EDITOR }]
          : []),
      ],
      skipDuplicates: true,
    });

    return canvasId;
  }

  /** Notes canvas content as Markdown for the summary prompt, or null when there is none. */
  async getNotesMarkdown(call: NotesCall & Pick<Call, 'externalId' | 'createdByUserId'>): Promise<string | null> {
    try {
      const canvasId = await this.resolveNotesCanvasId(call);
      if (!canvasId) return null;

      const blocks = await readFromYSweet(canvasId, call.createdByUserId);
      if (blocks.length === 0) return null;

      const markdown = (await convertBlockNoteToMarkdown(blocks)).trim();
      if (markdown.length <= MAX_NOTES_CONTEXT_CHARS) return markdown || null;

      // Series notes accumulate over time; keep the most recent part, starting at a line boundary.
      const tail = markdown.slice(-MAX_NOTES_CONTEXT_CHARS);
      return tail.slice(tail.indexOf('\n') + 1);
    } catch (error) {
      logger.warn(`[${call.externalId}] call_notes_context_unavailable`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

export const callNotesCanvasService = new CallNotesCanvasService();
