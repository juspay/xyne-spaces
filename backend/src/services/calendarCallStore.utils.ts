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

/** Stable JSON stringify — sorts keys recursively and skips undefined values (matching JSON.stringify behaviour) so key-insertion order and absent-vs-undefined differences don't affect equality checks. */
function stableStringify(val: unknown): string {
  if (val === undefined) return 'null';
  if (val === null || typeof val !== 'object') return JSON.stringify(val);
  if (Array.isArray(val)) return `[${val.map(stableStringify).join(',')}]`;
  const sorted = Object.keys(val as object)
    .filter(k => (val as Record<string, unknown>)[k] !== undefined)
    .sort()
    .map(k => `${JSON.stringify(k)}:${stableStringify((val as Record<string, unknown>)[k])}`);
  return `{${sorted.join(',')}}`;
}

function hasExternalCallChanged(
  existing: {
    title: string | null;
    description: string | null;
    status: CallStatus;
    roomLink: string | null;
    startsAt: Date | null;
    endsAt: Date | null;
    timezone: string;
    metadata: Prisma.JsonValue;
  },
  data: ExternalCalendarCallData,
): boolean {
  return (
    existing.title !== (data.title ?? null) ||
    existing.description !== (data.description ?? null) ||
    existing.status !== data.status ||
    existing.roomLink !== (data.roomLink ?? null) ||
    existing.startsAt?.getTime() !== data.startsAt?.getTime() ||
    existing.endsAt?.getTime() !== data.endsAt?.getTime() ||
    existing.timezone !== data.timezone ||
    stableStringify(existing.metadata) !== stableStringify(data.metadata)
  );
}

/**
 * Upsert a single external calendar event as a Call row.
 * Create-vs-update split: new rows get a fresh uuid + createdAt;
 * existing rows are only written when a mutable field has actually changed,
 * preventing unnecessary DB writes (and timestamp churn) on unchanged events.
 */
export async function upsertExternalCalendarCall(
  data: ExternalCalendarCallData,
  now: Date,
): Promise<void> {
  const existing = await (prisma.call.findUnique as (args: unknown) => Promise<{
    id: string;
    title: string | null;
    description: string | null;
    status: CallStatus;
    roomLink: string | null;
    startsAt: Date | null;
    endsAt: Date | null;
    timezone: string;
    metadata: Prisma.JsonValue;
  } | null>)({
    where: { externalId: data.externalId },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      roomLink: true,
      startsAt: true,
      endsAt: true,
      timezone: true,
      metadata: true,
    },
  });

  if (!existing) {
    await (prisma.call.create as (args: unknown) => Promise<{ id: string }>)({
      data: {
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
    });
    return;
  }

  if (!hasExternalCallChanged(existing, data)) return;

  await (prisma.call.update as (args: unknown) => Promise<{ id: string }>)({
    where: { externalId: data.externalId },
    data: {
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
