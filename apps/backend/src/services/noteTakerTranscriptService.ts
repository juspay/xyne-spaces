import { Prisma, type Call } from '@prisma/client';
import { CallType } from '@xyne/shared';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { acquireLock, releaseLock } from '@/utils/distributedLock';
import { transcriptService, type TranscriptEntry, type MarkedItem } from '@/services/transcriptService';
import { callDocumentService, numberTranscriptSegments, type CitationContext } from '@/services/callDocumentService';
import { findExistingDetailedSummaryCanvas } from '@/services/canvasService';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';
import { tagService, TagServiceError } from '@/tags/service';
import { tagRepository } from '@/database/repositories/tagRepository';
import { TAG_FORMAT_REGEX, TagMethod } from '@xyne/shared';

// Generic Tag framework sourceType/category for note-taker call labels. No
// configKey is used, so tagService.createTag skips the "category must be
// configured" check entirely (see assertManualCategoryOrOverride).
const NOTE_TAKER_TAG_SOURCE_TYPE = 'CALL';
const NOTE_TAKER_LABEL_CATEGORY = 'topic';

interface DetailedSummaryCanvasResult {
  canvasId: string;
  summaryTemplateId: string;
}

/**
 * Moments the user flagged during the recording, read back off a Call row.
 * They share Call.markedItems with the decisions/actions generated here, and the
 * type filter is what keeps re-runs idempotent: a second pass drops the previous
 * run's generated items and keeps only the user's.
 */
function userMarkedMoments(markedItems: Call['markedItems']): MarkedItem[] {
  if (!Array.isArray(markedItems)) return [];

  return markedItems.filter(
    (item): item is MarkedItem & Prisma.JsonObject =>
      !!item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      (item as Record<string, unknown>).type === 'moment',
  );
}

/** Marked items come from JSON, so the timestamp can be anything at runtime. */
function markedItemTimestamp(item: MarkedItem): number {
  return typeof item.timestampSeconds === 'number' ? item.timestampSeconds : 0;
}

/**
 * NOTE_TAKER (HEADLESS / "Xyne Oats") call transcript pipeline.
 *
 * Entry points: transcriptionAgentController.transcriptReady and
 * livekitWebhookController's room_finished reconcile fallback route
 * NOTE_TAKER calls here directly, before any channel/message-based logic runs.
 * Note-taker calls never have a channel and never have a message/conversation
 * — this file owns the whole path and must NEVER create or post a message
 * anywhere, and no LLM operation here posts anything anywhere by default. It
 * only:
 *   - uploads the formatted transcript directly to storage and persists the
 *     path onto the Call record (no message, no conversation, no
 *     MessageAttachment — nothing else reads or renders one for note-taker calls),
 *   - generates the AI summary and saves it directly on the Call record,
 *   - generates the detailed summary canvas and stores its id on
 *     Call.metadata.detailedSummaryCanvasId (same pattern as notesCanvasId) —
 *     the canvas is created/updated but never posted anywhere,
 *   - generates topical labels and stores them as generic Tag rows, with the
 *     resulting tag ids saved on Call.labels,
 *   - generates key decisions/action items (each anchored to a transcript
 *     timestamp) and stores them directly on Call.markedItems,
 *   - queues Vespa search indexing for the transcript.
 *
 * Dedup: the agent's transcript-ready webhook fires twice per call (initial +
 * post-STT-drain), and the room_finished reconcile fallback can also race it.
 * Rather than a MessageAttachment purely to track this, the raw transcript's
 * entry count already processed is stashed on Call.metadata.transcriptEntryCount
 * (mirroring detailedSummaryCanvasId) and checked once at the top of
 * processTranscript — a second run with no new entries is a cheap no-op.
 */
class NoteTakerTranscriptService {
  async processTranscript(call: Call, hasTranscript: boolean): Promise<void> {
    const callId = call.externalId;

    // Serialize processing per call — the room_finished reconcile fallback can
    // race the agent's transcript-ready webhook (itself fired twice). Wait for
    // the lock rather than skip, so a later/larger transcript still reprocesses.
    const lockHandle = await acquireLock(`lock:note-taker-transcript-processing:${callId}`, {
      ttlSeconds: 180,
      waitTimeoutMs: 30_000,
      retryDelayMs: 300,
    });
    if (!lockHandle) {
      logger.warn(`[${callId}] note_taker_process_lock_timeout`, {
        reason: 'another worker held the processing lock beyond the wait window',
      });
      return;
    }

    try {
      if (!hasTranscript) {
        logger.warn('transcript_processing_skipped', {
          call_id: callId,
          reason: 'agent_reported_no_transcript',
          path: 'note_taker',
        });
        return;
      }

      const rawContent = await transcriptService.retrieveTranscript(callId);
      if (!rawContent) {
        logger.warn(`[${callId}] note_taker_process_skipped`, { reason: 'no_gcs_transcript' });
        return;
      }
      const entries = transcriptService.parseTranscriptEntries(rawContent);
      if (entries.length === 0) {
        logger.warn(`[${callId}] note_taker_process_skipped`, { reason: 'no_transcript_entries' });
        return;
      }

      const storedEntryCount = this.getStoredEntryCount(call);
      if (entries.length <= storedEntryCount) {
        logger.info(`[${callId}] note_taker_process_skipped`, {
          reason: 'already_processed',
          current_entry_count: entries.length,
          stored_entry_count: storedEntryCount,
        });
        return;
      }

      try {
        await this.attachTranscript(call, entries);
      } catch (transcriptError) {
        logger.error(`[${callId}] post_transcript_failed`, {
          stage: 'attach_transcript',
          path: 'note_taker',
          error: transcriptError,
          stack: transcriptError instanceof Error ? transcriptError.stack : undefined,
        });
        // Don't rethrow — summary generation below uses the entries we already have
        // in memory and may still succeed even if the storage upload above failed.
      }

      const formattedTranscript = await this.getFormattedTranscript(callId, entries);
      if (!formattedTranscript) return;

      const generatedTitle = await this.generateAndSaveSummary(call, formattedTranscript);
      const detailedSummary = await this.generateDetailedSummaryCanvas(call, formattedTranscript);
      const labelIds = await this.generateAndSaveLabels(call, formattedTranscript);
      const markedItems = await this.generateMarkedItemsList(call, formattedTranscript);
      await this.finalizeCallUpdates(call, {
        metadata: {
          transcriptEntryCount: entries.length,
          detailedSummaryCanvasId: detailedSummary?.canvasId,
          generatedLabelIds: labelIds.length > 0 ? labelIds : undefined,
          generatedTitle: generatedTitle ?? undefined,
        },
        labels: labelIds,
        markedItems,
        summaryTemplateId: detailedSummary?.summaryTemplateId,
      });
      await this.queueVespaIndexing(call);
    } finally {
      await releaseLock(lockHandle);
    }
  }

  /**
   * Merge locally captured outage audio into the canonical note-taker transcript.
   * Canonical JSONL and Call.transcript persistence are strict; derived AI outputs
   * are best-effort and retain their last known-good values on failure.
   */
  async applyRecordingRepair(
    callId: string,
    repairEntries: TranscriptEntry[],
    coverage: Array<{ startedAt: number; endedAt: number }>,
  ): Promise<void> {
    const lockHandle = await acquireLock(`lock:note-taker-transcript-processing:${callId}`, {
      ttlSeconds: 180,
      waitTimeoutMs: 30_000,
      retryDelayMs: 300,
    });
    if (!lockHandle) throw new Error('Timed out waiting for note-taker transcript lock');

    try {
      const call = await repositories.calls.findByExternalId(callId);
      if (!call || call.callType !== CallType.HEADLESS) {
        throw new Error('Headless recording not found');
      }
      const rawContent = await transcriptService.retrieveTranscriptAllowEmpty(callId);
      const baseEntries = rawContent ? transcriptService.parseTranscriptEntries(rawContent) : [];
      const mergedEntries = [
        ...baseEntries.filter(entry => {
          const timestampMs = entry.timestamp * 1000;
          return !coverage.some(interval =>
            timestampMs >= interval.startedAt && timestampMs < interval.endedAt,
          );
        }),
        ...repairEntries,
      ].sort((left, right) => left.timestamp - right.timestamp);

      await transcriptService.persistRawTranscript(callId, mergedEntries);
      // Unlike ordinary processing, a repair must not become MERGED unless the
      // formatted transcript path is durably visible on Call.transcript.
      await this.attachTranscript(call, mergedEntries);

      // The identified transcript cannot contain locally recovered audio, so
      // repaired AI outputs must use the newly committed canonical entries.
      const formattedTranscript = transcriptService.formatTranscript(mergedEntries, callId);
      if (!formattedTranscript) {
        await this.finalizeCallUpdates(call, { metadata: { transcriptEntryCount: mergedEntries.length } });
        return;
      }

      const metadata = this.getMetadata(call);
      const previousGeneratedLabels = Array.isArray(metadata.generatedLabelIds)
        ? metadata.generatedLabelIds.filter((id): id is string => typeof id === 'string')
        : [];
      const previousGeneratedTitle =
        typeof metadata.generatedTitle === 'string' ? metadata.generatedTitle : null;

      const generatedTitle = await this.generateAndSaveSummary(
        call,
        formattedTranscript,
        previousGeneratedTitle,
      ).catch(error => {
        logger.error(`[${callId}] repair_summary_refresh_failed`, { error, path: 'note_taker' });
        return null;
      });
      const detailedSummary = await this.generateDetailedSummaryCanvas(call, formattedTranscript);
      const generatedLabels = await this.generateAndSaveLabels(call, formattedTranscript);
      const generatedMarkedItems = await this.generateMarkedItemsList(call, formattedTranscript);
      const current = (await repositories.calls.findByExternalId(callId)) ?? call;
      const labels = generatedLabels.length > 0
        ? [...new Set([
            ...(current.labels ?? []).filter(id => !previousGeneratedLabels.includes(id)),
            ...generatedLabels,
          ])]
        : undefined;

      await this.finalizeCallUpdates(current, {
        metadata: {
          transcriptEntryCount: mergedEntries.length,
          detailedSummaryCanvasId: detailedSummary?.canvasId,
          generatedLabelIds: generatedLabels.length > 0 ? generatedLabels : undefined,
          generatedTitle: generatedTitle ?? undefined,
        },
        labels,
        markedItems: generatedMarkedItems,
        summaryTemplateId: detailedSummary?.summaryTemplateId,
      });
      await this.queueVespaIndexing(current);
    } finally {
      await releaseLock(lockHandle);
    }
  }

  /**
   * Regenerate only the detailed-summary canvas with an explicitly selected
   * built-in template. The normal Call.aiSummary remains untouched.
   */
  async regenerateSummary(
    call: Call,
    templateId: string,
  ): Promise<{
    summaryTemplateId: string;
    detailedSummaryCanvasId: string | null;
  } | null> {
    const formattedTranscript = await transcriptService.getTranscriptContent(call.externalId);
    if (!formattedTranscript) return null;

    const detailedSummary = await this.generateDetailedSummaryCanvas(
      call,
      formattedTranscript,
      templateId,
    );
    if (!detailedSummary) return null;

    const currentMetadata =
      call.metadata && typeof call.metadata === 'object' && !Array.isArray(call.metadata)
        ? (call.metadata as Record<string, unknown>)
        : {};
    await repositories.calls.update(call.id, {
      metadata: {
        ...currentMetadata,
        detailedSummaryCanvasId: detailedSummary.canvasId,
      },
      summaryTemplateId: detailedSummary.summaryTemplateId,
    });

    return {
      summaryTemplateId: detailedSummary.summaryTemplateId,
      detailedSummaryCanvasId: detailedSummary.canvasId,
    };
  }

  /**
   * Fallback for when the agent's transcript-ready webhook never arrives (agent
   * OOM/SIGKILLed mid-call): reconcile whatever was already streamed to GCS.
   * processTranscript's own entryCount gate makes this a safe no-op when
   * transcript-ready already handled the call, so this is just a thin wrapper.
   */
  async reconcileTranscript(callId: string): Promise<void> {
    try {
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        logger.info(`[${callId}] note_taker_reconcile_skipped`, { reason: 'call_not_found' });
        return;
      }
      await this.processTranscript(call, true);
    } catch (error) {
      logger.error(`[${callId}] note_taker_reconcile_failed`, {
        error,
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  private getStoredEntryCount(call: Call): number {
    const metadata = this.getMetadata(call);
    const stored = metadata?.transcriptEntryCount;
    return typeof stored === 'number' ? stored : -1;
  }

  private getMetadata(call: Call): Record<string, unknown> {
    return call.metadata && typeof call.metadata === 'object' && !Array.isArray(call.metadata)
      ? (call.metadata as Record<string, unknown>)
      : {};
  }

  /**
   * Single combined Call write for anything computed during this run
   * (metadata fields, labels, markedItems). Merging everything here — instead
   * of each step writing independently — avoids one step's write clobbering
   * another's, since all start from the same in-memory `call` snapshot.
   * Metadata entries that are null/undefined are skipped (e.g. canvas
   * generation failed); labels/markedItems are only written when non-empty,
   * so a transient LLM failure never clobbers a previously-saved good result.
   *
   * markedItems is a full-column overwrite, but the user's own marked moments
   * live in that same column (written mid-recording by calls.markMoment), so
   * they are carried over here — otherwise finishing a call would erase every
   * moment the user flagged during it. Those are re-read below rather than taken
   * from `call`, which is the one field where the snapshot is not good enough.
   */
  private async finalizeCallUpdates(
    call: Call,
    updates: {
      metadata?: Record<string, unknown>;
      labels?: string[];
      markedItems?: MarkedItem[];
      summaryTemplateId?: string | null;
    },
  ): Promise<void> {
    const metadataChanges = updates.metadata
      ? Object.entries(updates.metadata).filter(([, v]) => v !== null && v !== undefined)
      : [];

    const data: {
      metadata?: Record<string, unknown>;
      labels?: string[];
      markedItems?: Prisma.InputJsonValue[];
      summaryTemplateId?: string | null;
    } = {};
    if (metadataChanges.length > 0) {
      const currentMetadata =
        call.metadata && typeof call.metadata === 'object' && !Array.isArray(call.metadata)
          ? (call.metadata as Record<string, unknown>)
          : {};
      data.metadata = { ...currentMetadata, ...Object.fromEntries(metadataChanges) };
    }
    if (updates.labels && updates.labels.length > 0) {
      data.labels = updates.labels;
    }
    if (updates.markedItems && updates.markedItems.length > 0) {
      
      const current = await repositories.calls.findByExternalId(call.externalId);
      const existingMoments = userMarkedMoments(current?.markedItems ?? call.markedItems);

      const merged = [...existingMoments, ...updates.markedItems];
      merged.sort((a, b) => markedItemTimestamp(a) - markedItemTimestamp(b));
      data.markedItems = merged as unknown as Prisma.InputJsonValue[];
    }
    if (updates.summaryTemplateId !== undefined) {
      data.summaryTemplateId = updates.summaryTemplateId;
    }

    if (Object.keys(data).length === 0) return;

    try {
      await repositories.calls.update(call.id, data);
      logger.info(`[${call.externalId}] call_record_updated`, {
        fields_updated: Object.keys(data).join(','),
        path: 'note_taker',
      });
    } catch (error) {
      logger.error(`[${call.externalId}] metadata_update_failed`, { error, path: 'note_taker' });
    }
  }

  /**
   * Upload the formatted transcript to storage and persist the path onto the
   * Call record directly — no message, no conversation, no MessageAttachment.
   * `entries` is passed in from processTranscript (which already fetched/parsed
   * it for the dedup check) so this doesn't refetch/reparse from GCS.
   */
  private async attachTranscript(call: Call, entries: TranscriptEntry[]): Promise<void> {
    const callId = call.externalId;

    const formattedTranscript = transcriptService.formatTranscript(entries, callId);
    const storagePath = await transcriptService.uploadFormattedTranscript(callId, formattedTranscript);

    await repositories.calls.update(call.id, { transcript: storagePath });
    logger.info(`[${callId}] call_record_updated`, { fields_updated: 'transcript', path: 'note_taker' });

    // Fire-and-forget: translate transcript asynchronously in the background.
    transcriptService.translateTranscriptAsync(callId, storagePath).catch((err) => {
      logger.error(`[${callId}] background_translation_failed`, { error: err, path: 'note_taker' });
    });
  }

  /**
   * Prefer the identified transcript (real speaker names) for the summary when
   * available, falling back to the already-parsed plain entries. Returns null
   * (having already logged why) when there's nothing usable to summarize.
   */
  private async getFormattedTranscript(callId: string, plainEntries: TranscriptEntry[]): Promise<string | null> {
    const speakerIdentificationEnabled = await transcriptService.isSpeakerIdentificationEnabled();

    if (speakerIdentificationEnabled) {
      const identifiedContent = await transcriptService.getIdentifiedTranscriptContent(callId);
      if (identifiedContent) return identifiedContent;
      logger.warn(`[${callId}] identified_transcript_unavailable`, { action: 'fallback_to_plain', path: 'note_taker' });
    }

    return transcriptService.formatTranscript(plainEntries, callId);
  }

  private async generateAndSaveSummary(
    call: Call,
    formattedTranscript: string,
    replaceGeneratedTitle: string | null = null,
  ): Promise<string | null> {
    const callId = call.externalId;

    // Number the transcript so the LLM can cite segments with [clf-N] tokens.
    // The tokens stay inline in the stored aiSummary and are parsed client-side.
    const { numbered: numberedTranscript } = numberTranscriptSegments(formattedTranscript);

    const [summary, generatedTitle] = await Promise.all([
      transcriptService.generateCallSummary(numberedTranscript, callId).catch((err) => {
        logger.error(`[${callId}] generate_summary_threw`, {
          path: 'note_taker',
          error: err,
          stack: err instanceof Error ? err.stack : undefined,
        });
        return null;
      }),
      call.title && replaceGeneratedTitle === null
        ? Promise.resolve(null)
        : transcriptService.generateCallTitle(formattedTranscript, callId).catch((err) => {
            logger.error(`[${callId}] generate_title_threw`, {
              path: 'note_taker',
              error: err,
              stack: err instanceof Error ? err.stack : undefined,
            });
            return null;
          }),
    ]);

    const title = generatedTitle
      ?.split(/\r?\n/, 1)[0]
      ?.trim()
      .replace(/^['"]|['"]$/g, '')
      .slice(0, 100);

    if (!summary && !title) {
      logger.error(`[${callId}] ai_summary_skipped`, { reason: 'generation_failed', path: 'note_taker' });
      return null;
    }

    // `call` was snapshotted when processing started, which by now can be a minute
    // ago — long enough for the user to have renamed the recording while the LLM was
    // working. Re-read the title so the generated one never lands on a name they typed.
    const latestTitle = (await repositories.calls.findByExternalId(callId))?.title;
    const titleToSave = title && (!latestTitle || latestTitle === replaceGeneratedTitle) ? title : null;

    if (!summary && !titleToSave) {
      logger.info(`[${callId}] ai_title_discarded`, {
        reason: 'renamed_during_processing',
        path: 'note_taker',
      });
      return null;
    }

    try {
      await repositories.calls.update(call.id, {
        ...(summary ? { aiSummary: summary } : {}),
        ...(titleToSave ? { title: titleToSave } : {}),
      });
      logger.info(`[${callId}] call_record_updated`, {
        fields_updated: [summary ? 'aiSummary' : '', titleToSave ? 'title' : '']
          .filter(Boolean)
          .join(','),
        path: 'note_taker',
      });
    } catch (updateError) {
      // P2025: call was deleted while summary was being generated — ignore gracefully
      if (updateError instanceof Prisma.PrismaClientKnownRequestError && updateError.code === 'P2025') {
        logger.warn(`[${callId}] call_deleted_before_summary_save | skipping update`);
        return null;
      }
      logger.error(`[${callId}] call_record_update_failed`, {
        stage: 'call_record_update',
        path: 'note_taker',
        error: updateError,
        stack: updateError instanceof Error ? updateError.stack : undefined,
      });
      return null;
    }
    return titleToSave;
  }

  /**
   * Generate the detailed summary and create/update its canvas. A brand-new
   * canvas is created from the first content delta and attached directly to the
   * Call so the recording UI can watch later Y-Sweet writes live. Regeneration
   * keeps the previous good canvas until the replacement is complete. No
   * channel or message is created — workspaceId comes from the Call record.
   */
  private async generateDetailedSummaryCanvas(
    call: Call,
    formattedTranscript: string,
    templateId?: string,
  ): Promise<DetailedSummaryCanvasResult | null> {
    const callId = call.externalId;

    const workspaceId = call.workspaceId;
    if (!workspaceId) {
      logger.warn(`[${callId}] detailed_summary_skipped`, { reason: 'no_workspace', path: 'note_taker' });
      return null;
    }

    try {
      // Number the transcript segments so the LLM can cite them, and build the
      // token→segment map used to turn `[clf-n]` tokens into canvas citation chips.
      // Note-taker calls have no channel, so speaker→userId resolution is skipped
      // (the frontend falls back to initials for unknown speakers).
      const { numbered: numberedTranscript, segments } = numberTranscriptSegments(formattedTranscript);
      const citationCtx: CitationContext = {
        callId,
        segments: new Map(segments.map(s => [s.n, s])),
      };

      const latestCall = await repositories.calls.findByExternalId(callId);
      const resolvedCallTitle = latestCall?.title ?? call.title;
      const xyneAutomaticBotPromise = unifiedBotUserService
        .getBotByBotId('xyne-automatic', workspaceId)
        .catch(error => {
          logger.error(`[${callId}] detailed_summary_bot_lookup_failed`, {
            path: 'note_taker',
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        });

      // Regeneration deliberately keeps the last good canvas visible until the
      // replacement is complete. Only a brand-new recording summary streams.
      const existingCanvas = await findExistingDetailedSummaryCanvas(callId);
      if (existingCanvas) {
        const generated = await callDocumentService.generateRecordingSummary(
          numberedTranscript,
          callId,
          templateId,
        );
        if (!generated) {
          logger.error(`[${callId}] detailed_summary_skipped`, {
            reason: 'generation_failed',
            path: 'note_taker',
          });
          return null;
        }

        const xyneAutomaticBot = await xyneAutomaticBotPromise;
        if (!xyneAutomaticBot) {
          logger.error(`[${callId}] detailed_summary_skipped`, {
            reason: 'bot_not_found',
            path: 'note_taker',
          });
          return null;
        }

        const { canvasId } = await callDocumentService.createOrUpdateDetailedSummaryCanvas(
          callId,
          generated.summary,
          xyneAutomaticBot.id,
          null,
          null,
          call.startedAt,
          call.createdByUserId,
          resolvedCallTitle,
          citationCtx,
          workspaceId,
        );
        if (!canvasId) {
          logger.error(`[${callId}] detailed_summary_skipped`, {
            reason: 'canvas_update_failed',
            path: 'note_taker',
          });
          return null;
        }

        return { canvasId, summaryTemplateId: generated.template.id };
      }

      const SYNC_INTERVAL_MS = 300;
      const sleepMs = (ms: number): Promise<void> =>
        new Promise(resolve => setTimeout(resolve, ms));
      let latestMarkdown = '';
      let renderedMarkdown = '';
      let newCanvasId: string | null = null;
      let canvasInitialization: Promise<void> | null = null;
      let canvasInitializationError: Error | null = null;
      const getCanvasInitializationError = (): Error | null => canvasInitializationError;
      let writerActive = false;
      let writerLoop: Promise<void> | null = null;

      const flushLatest = async (): Promise<void> => {
        if (!newCanvasId || latestMarkdown === renderedMarkdown) return;

        const snapshot = latestMarkdown;
        const synced = await callDocumentService.syncStreamingDetailedSummaryCanvas(
          newCanvasId,
          snapshot,
          citationCtx,
        );
        if (synced) {
          renderedMarkdown = snapshot;
        } else {
          logger.warn(`[${callId}] recording_summary_canvas_stream_sync_failed`, {
            canvas_id: newCanvasId,
          });
        }
      };

      const startWriter = (): void => {
        if (writerLoop) return;
        writerActive = true;
        writerLoop = (async (): Promise<void> => {
          while (writerActive) {
            await flushLatest();
            await sleepMs(SYNC_INTERVAL_MS);
          }
        })();
      };

      const ensureStreamingCanvas = async (
        firstMarkdown: string,
        startLiveWriter = true,
      ): Promise<void> => {
        if (canvasInitialization || canvasInitializationError) {
          if (canvasInitialization) await canvasInitialization;
          return;
        }

        canvasInitialization = (async (): Promise<void> => {
          const xyneAutomaticBot = await xyneAutomaticBotPromise;
          if (!xyneAutomaticBot) {
            throw new Error('Xyne Automatic bot not found');
          }

          const canvasId = await callDocumentService.createDetailedSummaryCanvas(
            callId,
            firstMarkdown,
            xyneAutomaticBot.id,
            null,
            null,
            call.startedAt,
            call.createdByUserId,
            resolvedCallTitle,
            citationCtx,
            workspaceId,
            { deferInsertSideEffects: true },
          );
          if (!canvasId) {
            throw new Error('Failed to create detailed summary canvas');
          }

          // Publish the id as soon as the initial Y-Sweet document exists. The
          // V2 recording screen observes this metadata through Zero and mounts
          // its collaborative editor while later chunks are still arriving.
          const currentCall = await repositories.calls.findByExternalId(callId);
          const currentMetadata =
            currentCall?.metadata &&
            typeof currentCall.metadata === 'object' &&
            !Array.isArray(currentCall.metadata)
              ? (currentCall.metadata as Record<string, unknown>)
              : {};
          await repositories.calls.update(call.id, {
            metadata: { ...currentMetadata, detailedSummaryCanvasId: canvasId },
          });

          newCanvasId = canvasId;
          renderedMarkdown = firstMarkdown;
          logger.info(`[${callId}] recording_summary_canvas_stream_started`, {
            canvas_id: canvasId,
          });
          if (startLiveWriter) startWriter();
        })().catch(error => {
          canvasInitializationError =
            error instanceof Error ? error : new Error(String(error));
          logger.error(`[${callId}] recording_summary_canvas_initialization_failed`, {
            error: canvasInitializationError.message,
          });
        });

        await canvasInitialization;
      };

      let generated: Awaited<ReturnType<typeof callDocumentService.generateRecordingSummary>>;
      try {
        generated = await callDocumentService.generateRecordingSummary(
          numberedTranscript,
          callId,
          templateId,
          async accumulated => {
            latestMarkdown = accumulated;
            await ensureStreamingCanvas(accumulated);
          },
        );
      } finally {
        writerActive = false;
        if (writerLoop) await writerLoop;
        await flushLatest();
      }

      if (!generated) {
        logger.error(`[${callId}] detailed_summary_skipped`, {
          reason: 'generation_failed',
          path: 'note_taker',
        });
        return null;
      }

      // Defensive fallback for providers that return final content without any
      // content delta. There is no live writer to start because generation is done.
      if (!newCanvasId && !canvasInitializationError) {
        latestMarkdown = generated.summary;
        await ensureStreamingCanvas(generated.summary, false);
      }

      const initializationFailure = getCanvasInitializationError();
      if (initializationFailure || !newCanvasId) {
        logger.error(`[${callId}] detailed_summary_skipped`, {
          reason: initializationFailure?.message ?? 'canvas_create_failed',
          path: 'note_taker',
        });
        return null;
      }

      const xyneAutomaticBot = await xyneAutomaticBotPromise;
      if (!xyneAutomaticBot) {
        logger.error(`[${callId}] detailed_summary_skipped`, {
          reason: 'bot_not_found',
          path: 'note_taker',
        });
        return null;
      }

      const finalized = await callDocumentService.finalizeDetailedSummaryCanvas(
        newCanvasId,
        generated.summary,
        xyneAutomaticBot.id,
        null,
        callId,
        call.startedAt,
        resolvedCallTitle,
        citationCtx,
      );
      if (!finalized) {
        logger.error(`[${callId}] detailed_summary_skipped`, {
          reason: 'canvas_finalize_failed',
          path: 'note_taker',
        });
        return null;
      }

      return { canvasId: newCanvasId, summaryTemplateId: generated.template.id };
    } catch (error) {
      logger.error(`[${callId}] detailed_summary_failed`, {
        stage: 'detailed_summary_generation',
        path: 'note_taker',
        error,
        stack: error instanceof Error ? error.stack : undefined,
      });
      return null;
    }
  }

  /**
   * Generate a small set of topical labels and persist each as a generic Tag
   * row (sourceId = call.id, sourceType = 'CALL'), returning the resulting
   * tag ids for Call.labels. Returns [] on any failure — callers treat that
   * as "nothing to add", never clobbering a previously-saved good result.
   */
  private async generateAndSaveLabels(call: Call, formattedTranscript: string): Promise<string[]> {
    const callId = call.externalId;
    if (!call.workspaceId) {
      logger.warn(`[${callId}] labels_skipped`, { reason: 'no_workspace', path: 'note_taker' });
      return [];
    }

    const labels = await transcriptService.generateCallLabels(formattedTranscript, callId).catch((err) => {
      logger.error(`[${callId}] generate_labels_threw`, {
        path: 'note_taker',
        error: err,
        stack: err instanceof Error ? err.stack : undefined,
      });
      return [] as string[];
    });
    if (labels.length === 0) return [];

    const tagIds: string[] = [];
    for (const rawLabel of labels) {
      if (tagIds.length >= 4) break;
      const slug = this.slugifyLabel(rawLabel);
      if (!slug) continue;
      try {
        const tagId = await this.getOrCreateLabelTag(call, slug);
        if (tagId && !tagIds.includes(tagId)) tagIds.push(tagId);
      } catch (error) {
        logger.error(`[${callId}] label_tag_failed`, { label: slug, path: 'note_taker', error });
      }
    }
    return tagIds;
  }

  /** Normalize an LLM-generated label into the Tag framework's required format (lowercase, hyphenated). */
  private slugifyLabel(raw: string): string | null {
    const slug = raw
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!slug) return null;
    const safe = /^[a-z]/.test(slug) ? slug : `l-${slug}`;
    return TAG_FORMAT_REGEX.test(safe) ? safe : null;
  }

  /**
   * Reuse an existing label tag for this call if a prior run already created
   * it, else create it via the generic Tag framework. No configKey is passed,
   * so tagService.createTag doesn't require a workspace-level TagsConfig for
   * the "topic" category (see assertManualCategoryOrOverride).
   */
  private async getOrCreateLabelTag(call: Call, slug: string): Promise<string | null> {
    const existing = await tagRepository.findActiveTag(call.id, NOTE_TAKER_TAG_SOURCE_TYPE, NOTE_TAKER_LABEL_CATEGORY, slug);
    if (existing) return existing.id;

    try {
      const created = await tagService.createTag(
        call.id,
        NOTE_TAKER_TAG_SOURCE_TYPE,
        call.workspaceId!,
        NOTE_TAKER_LABEL_CATEGORY,
        slug,
        TagMethod.LLM,
      );
      return created.id;
    } catch (error) {
      // 409 = another run/racing worker created the same tag between the find and create above.
      if (error instanceof TagServiceError && error.status === 409) {
        const raced = await tagRepository.findActiveTag(call.id, NOTE_TAKER_TAG_SOURCE_TYPE, NOTE_TAKER_LABEL_CATEGORY, slug);
        return raced?.id ?? null;
      }
      throw error;
    }
  }

  /**
   * Generate key decisions/action items, each anchored to a transcript
   * timestamp. Returns [] on any failure or when nothing qualifies.
   */
  private async generateMarkedItemsList(call: Call, formattedTranscript: string): Promise<MarkedItem[]> {
    const callId = call.externalId;
    return transcriptService.generateMarkedItems(formattedTranscript, callId).catch((err) => {
      logger.error(`[${callId}] generate_marked_items_threw`, {
        path: 'note_taker',
        error: err,
        stack: err instanceof Error ? err.stack : undefined,
      });
      return [] as MarkedItem[];
    });
  }

  // Indexing only — not a message post. Uses the Call's own denormalized
  // workspaceId directly since note-taker calls have no channel to look up.
  private async queueVespaIndexing(call: Call): Promise<void> {
    try {
      await vespaQueue.addJob({
        schema: fileSchema,
        docId: call.id,
        jobType: 'feed',
        userId: call.createdByUserId,
        app: SubApp.TRANSCRIPT,
        ...(call.workspaceId ? { workspaceId: call.workspaceId } : {}),
      });
      logger.info(`[NoteTakerTranscriptService] Queued Vespa indexing for transcript ${call.id}`, { path: 'note_taker' });
    } catch (vespaError) {
      logger.error(`[NoteTakerTranscriptService] Failed to queue Vespa job for transcript ${call.id}:`, vespaError);
    }
  }
}

export const noteTakerTranscriptService = new NoteTakerTranscriptService();
