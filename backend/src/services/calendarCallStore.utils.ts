/**
 * Shared DB utilities for external calendar → Call upsert/cancel logic.
 * Used by both googleCalendarCallStore and microsoftCalendarCallStore.
 */

import { v4 as uuidv4 } from 'uuid';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { CallOrigin, CallStatus, CallType, type Prisma } from '@prisma/client';

const prisma = DatabaseClient.getInstance();

// ─── Shared types ─────────────────────────────────────────────────────────────

/** Normalised attendee shape shared by both Google and Microsoft stores. */
export interface CalendarAttendee {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  self?: boolean;
}

/** Normalised organizer shape shared by both Google and Microsoft stores. */
export interface CalendarOrganizer {
  email?: string;
  displayName?: string;
  self?: boolean;
}

/** The provider-agnostic call data payload passed to upsertExternalCalendarCall. */
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

// ─── Shared DB helpers ────────────────────────────────────────────────────────

/**
 * Upsert a single external calendar event as a Call row.
 * Create-vs-update split: new rows get a fresh uuid + createdAt;
 * existing rows only update mutable fields.
 */
export async function upsertExternalCalendarCall(
  data: ExternalCalendarCallData,
  now: Date,
): Promise<void> {
  await (prisma.call.upsert as (args: unknown) => Promise<{ id: string }>)({
    where: { externalId: data.externalId },
    create: {
      id: uuidv4(),
      ...data,
      channelId: null,
      isRecurring: false,
      recordingEnabled: false,
      startedAt: now,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    },
    update: {
      title: data.title,
      description: data.description,
      status: data.status,
      roomLink: data.roomLink,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      timezone: data.timezone,
      metadata: data.metadata,
      updatedAt: now,
      lastActivityAt: now,
    },
    select: { id: true },
  });
}

/**
 * Cancel any stored calls for a given user + origin whose externalId is no
 * longer in the freshly-fetched set (deleted / rolled out of lookahead window).
 */
export async function cancelRemovedExternalCalendarCalls(
  userId: string,
  callOrigin: CallOrigin,
  fetchedExternalIds: Set<string>,
  logPrefix: string,
): Promise<void> {
  try {
    const existing = await prisma.call.findMany({
      where: {
        callOrigin,
        createdByUserId: userId,
        status: { not: CallStatus.CANCELLED },
      },
      select: { id: true, externalId: true },
    });

    const toCancel = existing.filter(c => !fetchedExternalIds.has(c.externalId));

    if (toCancel.length > 0) {
      await prisma.call.updateMany({
        where: { id: { in: toCancel.map(c => c.id) } },
        data: { status: CallStatus.CANCELLED, updatedAt: new Date() },
      });
      logger.info(`[${logPrefix}] Cancelled ${toCancel.length} removed event(s)`);
    }
  } catch (err) {
    logger.error(
      `[${logPrefix}] Failed to cancel removed events:`,
      err instanceof Error ? err.message : err,
    );
  }
}
