/**
 * Shared utilities for external calendar → Call upsert/cancel logic.
 * Used by both googleCalendarCallStore and microsoftCalendarCallStore.
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '@/utils/logger';
import { CallOrigin, CallStatus, CallType, type Prisma } from '@prisma/client';
import { repositories } from '@/database/repositories';

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
  await repositories.calls.upsertExternalCalendarCall({
    externalId: data.externalId,
    id: uuidv4(),
    title: data.title,
    description: data.description,
    createdByUserId: data.createdByUserId,
    callType: data.callType,
    callOrigin: data.callOrigin,
    status: data.status,
    roomLink: data.roomLink,
    startsAt: data.startsAt,
    endsAt: data.endsAt,
    timezone: data.timezone,
    channelId: null,
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
