import type { Call } from '@prisma/client';
import { repositories } from '@/database/repositories';
import { decrypt } from '@/services/encryptionService';
import { convertBlockNoteToMarkdown } from '@/services/canvasService';
import { readFromYSweetStrict } from '@/utils/ysweetUtils.js';
import { sendWebhookNotification } from '@/apps/core/eventSubscriptionUtils';
import {
  AppEventType,
  type BaseAppEvent,
  type CallSummaryParticipant,
  type CallSummaryReadyEventPayload,
} from '@/apps/types';
import { logger } from '@/utils/logger';

/**
 * Key stamped on Call.metadata when an app schedules a call through
 * POST /api/apps/calls/schedule. It is the only marker that a call is
 * app-owned, and the sole trigger for CALL_SUMMARY_READY.
 */
export const INITIATED_BY_INSTALLED_APP_ID_KEY = 'initiatedByInstalledAppId';

const TAG = '[CallSummaryAppEvent]';

function toMetadataObject(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

function readStringKey(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * Delivers CALL_SUMMARY_READY to the app that scheduled a call, once that
 * call's detailed summary is generated.
 *
 * Called from both auto-summary paths — the note-taker pipeline
 * (noteTakerTranscriptService.notifySummaryReady, which also covers every
 * regeneration) and the regular-call pipeline
 * (transcriptService.processCallWithSummary) — so a call reaches its app
 * whichever way its summary was produced.
 *
 * Every exit is best-effort and silent: a call with no owning app is the
 * normal case (anything scheduled from the UI), and a webhook failure must
 * never fail summary generation. Note there is no delivery retry: an app whose
 * webhook is down when this runs does not get that summary pushed again.
 */
export async function emitCallSummaryReadyToApp(callExternalId: string): Promise<void> {
  try {
    const call = await repositories.calls.findByExternalId(callExternalId);
    if (!call) return;

    const metadata = toMetadataObject(call.metadata);
    const installedAppId = readStringKey(metadata, INITIATED_BY_INSTALLED_APP_ID_KEY);
    if (!installedAppId) return; // scheduled by a human, not an app — nothing to deliver

    const canvasId = readStringKey(metadata, 'detailedSummaryCanvasId');
    if (!canvasId) {
      logger.warn(`${TAG} [${callExternalId}] skipped | reason=no_summary_canvas`, { installedAppId });
      return;
    }

    const installedApp = await repositories.installedApps.findById(installedAppId);
    // InstalledApps.signingSecret is deprecated — the app-level secret is the
    // one every app-facing signature is built from, same as authenticateApp.
    const app = installedApp ? await repositories.apps.findById(installedApp.appId) : null;
    const signingSecret = app?.signingSecret ?? null;
    if (!installedApp?.webhookUrl?.trim() || !signingSecret) {
      logger.info(`${TAG} [${callExternalId}] skipped | reason=webhook_not_configured`, { installedAppId });
      return;
    }

    // Strict read: the lenient variant answers [] when Y-Sweet is unreachable,
    // which would deliver an empty summary as though the call had nothing in it.
    const blocks = await readFromYSweetStrict(canvasId, call.createdByUserId);
    const summary = blocks.length > 0 ? await convertBlockNoteToMarkdown(blocks) : '';
    if (!summary.trim()) {
      logger.warn(`${TAG} [${callExternalId}] skipped | reason=empty_summary`, { installedAppId, canvasId });
      return;
    }

    const event: BaseAppEvent = {
      eventType: AppEventType.CALL_SUMMARY_READY,
      payload: await buildPayload(call, installedAppId, canvasId, summary),
      timestamp: new Date().toISOString(),
    };

    await sendWebhookNotification(installedApp.webhookUrl, event, decrypt(signingSecret));

    logger.info(`${TAG} [${callExternalId}] delivered`, {
      installedAppId,
      summaryLength: summary.length,
    });
  } catch (error) {
    logger.error(`${TAG} [${callExternalId}] delivery_failed`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

async function buildPayload(
  call: Call,
  installedAppId: string,
  canvasId: string,
  summary: string,
): Promise<CallSummaryReadyEventPayload> {
  const rows = await repositories.calls.findParticipantsForApps(call.externalId);
  const participants: CallSummaryParticipant[] = rows.map(row => ({
    userId: row.userId,
    name: row.name,
    email: row.email,
    isExternal: row.isExternal,
    joinedAt: row.joinedAt?.toISOString() ?? null,
    leftAt: row.leftAt?.toISOString() ?? null,
  }));

  return {
    callId: call.externalId,
    installedAppId,
    userId: call.createdByUserId,
    workspaceId: call.workspaceId,
    title: call.title,
    startedAt: call.startedAt?.toISOString() ?? null,
    endedAt: call.endedAt?.toISOString() ?? null,
    durationSeconds: computeDurationSeconds(call),
    summary,
    summaryTemplateId: call.summaryTemplateId,
    detailedSummaryCanvasId: canvasId,
    transcriptUrl: `/api/apps/calls/${call.externalId}/transcript`,
    participants,
  };
}

function computeDurationSeconds(call: Call): number | null {
  if (!call.startedAt || !call.endedAt) return null;
  const ms = new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime();
  return ms > 0 ? Math.round(ms / 1000) : null;
}
