import type { FeatureAnnouncement, UserSurfaceState } from '@prisma/client';
import {
  FEATURE_ANNOUNCEMENT_LIMITS,
  FeatureAnnouncementStatus,
  Platform,
  SurfaceKind,
  TriggerType,
  type FeatureAnnouncementPage,
  type FeatureAnnouncementPageView,
  type FeatureAnnouncementView,
} from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { featureAnnouncementContentCache } from '@/services/featureAnnouncementContentCache';
import {
  evaluateContentRules,
  evaluateStateRules,
  resolveFlags,
  type EligibilitySubject,
} from '@/services/featureAnnouncementEligibility';

const { MAX_SEEN_COUNT, SESSION_GAP_MS } = FEATURE_ANNOUNCEMENT_LIMITS;

/** Cap on how many announcements one response may carry, newest first. */
export const PENDING_BATCH_LIMIT = 1;

/**
 * Path relative to the API root, not an absolute URL. The client fetches it through the
 * authenticated API client rather than putting it straight in an `<img src>`, which
 * cannot carry the auth header to the backend origin.
 */
export function mediaPath(announcementId: string, index: number | 'cover'): string {
  return `/feature-announcements/${announcementId}/media/${index}`;
}

export function parsePages(value: unknown): FeatureAnnouncementPage[] {
  return Array.isArray(value) ? (value as FeatureAnnouncementPage[]) : [];
}

function toView(
  row: FeatureAnnouncement,
  state: UserSurfaceState | undefined
): FeatureAnnouncementView {
  const pages: FeatureAnnouncementPageView[] = parsePages(row.pages).map((page, index) => ({
    title: page.title,
    description: page.description,
    mediaUrl: page.mediaKey ? mediaPath(row.id, index) : null,
    mediaAlt: page.mediaAlt ?? null,
  }));

  return {
    id: row.id,
    key: row.key,
    title: row.title,
    description: row.description,
    mediaUrl: row.mediaKey ? mediaPath(row.id, 'cover') : null,
    mediaAlt: row.mediaAlt ?? null,
    ctaLabel: row.ctaLabel ?? null,
    ctaType: (row.ctaType as FeatureAnnouncementView['ctaType']) ?? null,
    ctaTarget: row.ctaTarget ?? null,
    pages,
    progress: state?.progress ?? null,
  };
}

/**
 * Best-effort mirror into the existing activity-event stream, written outside the
 * transaction that owns the authoritative state. Matches the shape already used by
 * `nudges.dismiss`: state first, telemetry after, and telemetry is allowed to fail.
 */
async function mirrorToActivityEvents(
  subject: EligibilitySubject,
  eventName: string,
  announcementId: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    await db.userActivityEvent.create({
      data: {
        userId: subject.userId,
        workspaceId: subject.workspaceId,
        sessionId: 'system',
        eventCategory: 'FEATURE_ANNOUNCEMENT',
        eventName,
        url: '',
        triggerType: TriggerType.DB_MUTATION,
        platform: Platform.WEB,
        timestamp: new Date(),
        contextMetadata: { announcementId, ...metadata },
      },
    });
  } catch (error) {
    logger.warn('[FeatureAnnouncementService] activity event mirror failed', {
      eventName,
      announcementId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function loadPublished(workspaceId: string): Promise<FeatureAnnouncement[]> {
  const cached = await featureAnnouncementContentCache.get(workspaceId);
  if (cached) return cached;

  const rows = await db.featureAnnouncement.findMany({
    where: { status: FeatureAnnouncementStatus.PUBLISHED },
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
  });
  await featureAnnouncementContentCache.set(workspaceId, rows);
  return rows;
}

class FeatureAnnouncementService {
  async getPending(
    subject: EligibilitySubject,
    now: Date = new Date()
  ): Promise<FeatureAnnouncementView[]> {
    const published = await loadPublished(subject.workspaceId);
    if (published.length === 0) return [];

    const candidates = published.filter((row) => evaluateContentRules(row, subject, now).eligible);
    if (candidates.length === 0) return [];

    const states = await db.userSurfaceState.findMany({
      where: {
        userId: subject.userId,
        surfaceKind: SurfaceKind.FEATURE_ANNOUNCEMENT,
        surfaceKey: { in: candidates.map((row) => row.id) },
      },
    });
    const stateById = new Map(states.map((state) => [state.surfaceKey, state]));

    const undecided = candidates.filter(
      (row) => evaluateStateRules(stateById.get(row.id), MAX_SEEN_COUNT).eligible
    );
    if (undecided.length === 0) return [];

    const flags = await resolveFlags(
      undecided.map((row) => row.cacKey).filter((key): key is string => Boolean(key)),
      subject
    );

    return undecided
      .filter((row) => !row.cacKey || flags.get(row.cacKey) === true)
      .slice(0, PENDING_BATCH_LIMIT)
      .map((row) => toView(row, stateById.get(row.id)));
  }

  async findPublishedById(
    subject: EligibilitySubject,
    announcementId: string
  ): Promise<FeatureAnnouncement | null> {
    const published = await loadPublished(subject.workspaceId);
    return published.find((row) => row.id === announcementId) ?? null;
  }

  /**
   * `seenAt` is written once — it means first viewed, not last viewed — and `progress`
   * only ever climbs, so reopening at page 0 cannot rewrite a completed funnel.
   *
   * A session is derived server-side from the gap since the last write. The clients have
   * no app-lifecycle session of their own, and an Electron window can stay alive for
   * weeks, so a client-supplied session id would not be trustworthy.
   */
  async recordSeen(
    subject: EligibilitySubject,
    announcementId: string,
    pageIndex: number,
    now: Date = new Date()
  ): Promise<UserSurfaceState> {
    const existing = await db.userSurfaceState.findUnique({
      where: {
        userId_surfaceKind_surfaceKey: {
          userId: subject.userId,
          surfaceKind: SurfaceKind.FEATURE_ANNOUNCEMENT,
          surfaceKey: announcementId,
        },
      },
    });

    const isNewSession = !existing || now.getTime() - existing.updatedAt.getTime() > SESSION_GAP_MS;

    const state = await db.userSurfaceState.upsert({
      where: {
        userId_surfaceKind_surfaceKey: {
          userId: subject.userId,
          surfaceKind: SurfaceKind.FEATURE_ANNOUNCEMENT,
          surfaceKey: announcementId,
        },
      },
      create: {
        workspaceId: subject.workspaceId,
        userId: subject.userId,
        surfaceKind: SurfaceKind.FEATURE_ANNOUNCEMENT,
        surfaceKey: announcementId,
        seenAt: now,
        seenCount: 1,
        progress: pageIndex,
      },
      update: {
        seenAt: existing?.seenAt ?? now,
        progress: Math.max(existing?.progress ?? 0, pageIndex),
        ...(isNewSession ? { seenCount: { increment: 1 } } : {}),
      },
    });

    if (!existing) {
      void mirrorToActivityEvents(subject, 'FEATURE_ANNOUNCEMENT_SEEN', announcementId, {
        pageIndex,
      });
    }
    return state;
  }

  /**
   * A CTA click burns only the announcement it belongs to. The cross means "stop showing
   * me things"; the CTA means "I am interested", and clearing a queue on a positive
   * signal is the wrong read.
   */
  async recordCta(
    subject: EligibilitySubject,
    announcementId: string,
    now: Date = new Date()
  ): Promise<UserSurfaceState> {
    const state = await db.userSurfaceState.upsert({
      where: {
        userId_surfaceKind_surfaceKey: {
          userId: subject.userId,
          surfaceKind: SurfaceKind.FEATURE_ANNOUNCEMENT,
          surfaceKey: announcementId,
        },
      },
      create: {
        workspaceId: subject.workspaceId,
        userId: subject.userId,
        surfaceKind: SurfaceKind.FEATURE_ANNOUNCEMENT,
        surfaceKey: announcementId,
        seenAt: now,
        seenCount: 1,
        actedAt: now,
        dismissedAt: now,
      },
      update: { actedAt: now, dismissedAt: now },
    });

    void mirrorToActivityEvents(subject, 'FEATURE_ANNOUNCEMENT_CTA_CLICKED', announcementId);
    return state;
  }

  /**
   * Writes `dismissedAt` for every announcement in the open batch, including ones whose
   * pages were never reached — leaving those pending would make the card reappear next
   * session, which is the nagging this design exists to remove. `seenAt` stays null on
   * those rows, so delivered and viewed remain distinguishable afterwards.
   */
  async dismiss(
    subject: EligibilitySubject,
    announcementIds: ReadonlyArray<string>,
    now: Date = new Date()
  ): Promise<number> {
    const ids = [...new Set(announcementIds)];
    if (ids.length === 0) return 0;

    await db.$transaction(
      ids.map((announcementId) =>
        db.userSurfaceState.upsert({
          where: {
            userId_surfaceKind_surfaceKey: {
              userId: subject.userId,
              surfaceKind: SurfaceKind.FEATURE_ANNOUNCEMENT,
              surfaceKey: announcementId,
            },
          },
          create: {
            workspaceId: subject.workspaceId,
            userId: subject.userId,
            surfaceKind: SurfaceKind.FEATURE_ANNOUNCEMENT,
            surfaceKey: announcementId,
            dismissedAt: now,
          },
          update: { dismissedAt: now },
        })
      )
    );

    for (const announcementId of ids) {
      void mirrorToActivityEvents(subject, 'FEATURE_ANNOUNCEMENT_DISMISSED', announcementId);
    }
    return ids.length;
  }
}

export const featureAnnouncementService = new FeatureAnnouncementService();
