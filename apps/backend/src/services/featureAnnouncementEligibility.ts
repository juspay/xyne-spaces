import type { FeatureAnnouncement } from '@prisma/client';
import { FeatureAnnouncementStatus } from '@xyne/shared';
import { superpositionClient } from '@/services/superpositionClient';
import { logger } from '@/utils/logger';

export interface EligibilitySubject {
  userId: string;
  workspaceId: string;
  userCreatedAt: Date;
}

export interface DismissalState {
  dismissedAt: Date | null;
  seenCount: number;
}

export type IneligibleReason =
  | 'NOT_PUBLISHED'
  | 'NOT_YET_LIVE'
  | 'EXPIRED'
  | 'OTHER_WORKSPACE'
  | 'PREDATES_USER'
  | 'DISMISSED'
  | 'SEEN_LIMIT'
  | 'FLAG_OFF';

export type EligibilityVerdict = { eligible: true } | { eligible: false; reason: IneligibleReason };

const ELIGIBLE: EligibilityVerdict = { eligible: true };

/**
 * Superposition values arrive as whatever the flag stores — a bare boolean, a string, or
 * a `{ enabled }` object. `CacConfigService.fetch` performs no coercion, so a disabled
 * `{ enabled: false }` flag is a truthy object. Every flag read for eligibility goes
 * through here instead.
 */
export function coerceFlagEnabled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'enabled';
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('enabled' in record) return coerceFlagEnabled(record.enabled);
    if ('value' in record) return coerceFlagEnabled(record.value);
  }
  return false;
}

/**
 * Resolves the whole config once and returns a per-key lookup. `CacConfigService.fetch`
 * resolves everything internally and discards all but one key, so calling it per
 * announcement would repeat that work for every flag on every request.
 */
export async function resolveFlags(
  cacKeys: ReadonlyArray<string>,
  subject: EligibilitySubject
): Promise<Map<string, boolean>> {
  const resolved = new Map<string, boolean>();
  const distinct = [...new Set(cacKeys)];
  if (distinct.length === 0) return resolved;

  let configs: Record<string, unknown> = {};
  try {
    configs = (await superpositionClient.resolveAllConfigDetails({
      userId: subject.userId,
      workspaceId: subject.workspaceId,
    })) as Record<string, unknown>;
  } catch (error) {
    logger.error('[FeatureAnnouncementEligibility] CAC resolution failed', { error });
  }

  for (const key of distinct) {
    resolved.set(key, coerceFlagEnabled(configs[key]));
  }
  return resolved;
}

/**
 * The rules that depend only on the row and the user record: publish window, workspace
 * targeting, and the new-user guard. Applied before the state read and the flag
 * resolution so those only cover rows that can still qualify.
 *
 * Rule 6 — `userCreatedAt < publishedAt` — is why a brand-new account does not receive the
 * entire back catalogue on first login. It is evaluated at read time rather than by
 * backfilling dismissal rows at signup, which would need a job per release and would race
 * with content creation.
 */
export function evaluateContentRules(
  announcement: Pick<FeatureAnnouncement, 'status' | 'publishedAt' | 'expiresAt' | 'workspaceId'>,
  subject: EligibilitySubject,
  now: Date
): EligibilityVerdict {
  if (announcement.status !== FeatureAnnouncementStatus.PUBLISHED) {
    return { eligible: false, reason: 'NOT_PUBLISHED' };
  }
  if (!announcement.publishedAt || announcement.publishedAt > now) {
    return { eligible: false, reason: 'NOT_YET_LIVE' };
  }
  if (announcement.expiresAt && announcement.expiresAt <= now) {
    return { eligible: false, reason: 'EXPIRED' };
  }
  if (announcement.workspaceId !== null && announcement.workspaceId !== subject.workspaceId) {
    return { eligible: false, reason: 'OTHER_WORKSPACE' };
  }
  if (subject.userCreatedAt >= announcement.publishedAt) {
    return { eligible: false, reason: 'PREDATES_USER' };
  }
  return ELIGIBLE;
}

/** The per-user rules: an explicit dismissal, or too many sessions without a decision. */
export function evaluateStateRules(
  state: DismissalState | undefined,
  maxSeenCount: number
): EligibilityVerdict {
  if (state?.dismissedAt) return { eligible: false, reason: 'DISMISSED' };
  if (state && state.seenCount >= maxSeenCount) return { eligible: false, reason: 'SEEN_LIMIT' };
  return ELIGIBLE;
}

export function evaluate(
  announcement: Pick<
    FeatureAnnouncement,
    'status' | 'publishedAt' | 'expiresAt' | 'workspaceId' | 'cacKey'
  >,
  subject: EligibilitySubject,
  state: DismissalState | undefined,
  flags: ReadonlyMap<string, boolean>,
  now: Date,
  maxSeenCount: number
): EligibilityVerdict {
  const content = evaluateContentRules(announcement, subject, now);
  if (!content.eligible) return content;

  const stateVerdict = evaluateStateRules(state, maxSeenCount);
  if (!stateVerdict.eligible) return stateVerdict;

  if (announcement.cacKey && !flags.get(announcement.cacKey)) {
    return { eligible: false, reason: 'FLAG_OFF' };
  }
  return ELIGIBLE;
}
