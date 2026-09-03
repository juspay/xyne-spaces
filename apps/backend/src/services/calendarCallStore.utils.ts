/**
 * Shared utilities for external calendar → Call upsert/cancel logic.
 * Used by both googleCalendarCallStore and microsoftCalendarCallStore.
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '@/utils/logger';
import { type Prisma } from '@prisma/client';
import { CallOrigin, CallStatus, CallType } from '@xyne/shared';
import { repositories } from '@/database/repositories';
import { livekitService } from '@/services/liveKitService';

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface CalendarAttendee {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  self?: boolean;
}

export interface CalendarOrganizer {
  email?: string;
  displayName?: string;
  self?: boolean;
}

export interface CalendarSyncTimeRange {
  startsAfter?: Date;
  startsBefore?: Date;
}

export type ExternalCalendarProvider = 'google' | 'microsoft';

export interface ExternalCalendarCallData {
  externalId: string;
  title: string;
  description?: string;
  createdByUserId: string;
  callType: CallType;
  callOrigin: CallOrigin;
  status: CallStatus;
  roomLink?: string;
  startsAt?: Date;
  endsAt?: Date;
  timezone: string;
  xyneManaged?: boolean;
  /** Self-DM channel backing a Xyne-managed call so LiveKit room creation on join succeeds. */
  channelId?: string | null;
  metadata: Prisma.InputJsonObject;
}

export function normalizeCalendarOwnerEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function buildCalendarExternalId(
  provider: ExternalCalendarProvider,
  userId: string,
  eventId: string
): string {
  const prefix = provider === 'google' ? 'gcal' : 'mscal';
  return `${prefix}__${userId}__${eventId}`;
}

export function buildCalendarExternalIdPrefix(
  provider: ExternalCalendarProvider,
  userId: string
): string {
  const prefix = provider === 'google' ? 'gcal' : 'mscal';
  return `${prefix}__${userId}__`;
}

// ─── Shared DB helpers ────────────────────────────────────────────────────────

export async function upsertExternalCalendarCall(
  data: ExternalCalendarCallData,
  now: Date
): Promise<void> {
  let status = data.status;

  // Calendar providers only know that a non-cancelled event is scheduled; they
  // do not know whether its Xyne room is currently live. A self-triggered
  // Calendar webhook (for example, after injecting the Xyne link) can arrive
  // after LiveKit has activated the Call. Do not let that stale Calendar state
  // downgrade a genuinely active room back to SCHEDULED.
  if (status === CallStatus.SCHEDULED) {
    const existing = await repositories.calls.findByExternalId(data.externalId);
    if (existing?.status === CallStatus.ACTIVE) {
      try {
        const rooms = await livekitService.listRooms([data.externalId]);
        const room = rooms.find((candidate) => candidate.name === data.externalId);
        if (room && room.numParticipants > 0) {
          status = CallStatus.ACTIVE;
          logger.info(`${data.externalId} Calendar sync preserved ACTIVE call status`, {
            numParticipants: room.numParticipants,
          });
        }
      } catch (err) {
        // A transient LiveKit lookup failure is not evidence that the call has
        // ended. Preserve ACTIVE and let room_finished/call validation perform
        // the authoritative transition later.
        status = CallStatus.ACTIVE;
        logger.warn(`${data.externalId} LiveKit status check failed; preserving ACTIVE`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  await repositories.calls.upsertExternalCalendarCall({
    externalId: data.externalId,
    id: uuidv4(),
    title: data.title,
    description: data.description,
    createdByUserId: data.createdByUserId,
    callType: data.callType,
    callOrigin: data.callOrigin,
    status,
    roomLink: data.roomLink,
    startsAt: data.startsAt,
    endsAt: data.endsAt,
    timezone: data.timezone,
    xyneManaged: data.xyneManaged ?? false,
    channelId: data.channelId ?? null,
    isRecurring: false,
    recordingEnabled: false,
    startedAt: now,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
    metadata: data.metadata,
  });
}

export async function cancelRemovedExternalCalendarCalls(
  externalIdPrefix: string,
  callOrigin: CallOrigin,
  fetchedExternalIds: Set<string>,
  logPrefix: string,
  timeRange?: CalendarSyncTimeRange
): Promise<void> {
  try {
    const existing = await repositories.calls.findExternalCalendarCalls({
      callOrigin,
      externalIdPrefix,
      statusNot: CallStatus.CANCELLED,
      timeRange,
    });

    const toCancel = existing.filter((c) => !fetchedExternalIds.has(c.externalId));

    if (toCancel.length > 0) {
      await repositories.calls.cancelByIds(toCancel.map((c) => c.id));
      logger.info(`${logPrefix} Cancelled ${toCancel.length} removed event(s)`);
    }
  } catch (err) {
    logger.error(
      `${logPrefix} Failed to cancel removed events:`,
      err instanceof Error ? err.message : err
    );
  }
}
