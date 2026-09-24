import type { Call, RecurringCallSeries } from '@prisma/client';
import { CallOrigin, CallStatus, RecurringCallSeriesStatus } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { hasResourceAdminAccess } from '@/database/acl/admin-access';

/**
 * Who may do what in the calls admin panel. Single source of truth for the panel:
 * the controller asserts against it and the list endpoints decorate every row with
 * `allowedActions`, so the UI never has to work out permissions itself.
 *
 * Tiers: ORG is a SCRIBE:ADMIN grant (direct or via a group) and covers every call
 * in the workspace; everyone else is SELF and reaches only calls they created or
 * participate in. The per-user call ACL is bypassed for this panel (the router runs
 * workspace-scoped), so these checks are the only thing standing in for it.
 */

export type CallAdminScope = 'ORG' | 'SELF';
export type CallAdminRelation = 'ADMIN' | 'CREATOR' | 'PARTICIPANT' | 'NONE';
export type CallAdminAction =
  | 'cancel'
  | 'forceEnd'
  | 'unlinkTranscript'
  | 'regenerateSummary'
  | 'reprocessTranscript'
  | 'changeOwner';

/**
 * Action × relation matrix. Participants only get the actions that repair a call
 * without changing what it contains or who owns it — in particular not reprocess,
 * which would undo an owner's or admin's unlink.
 */
export const CALL_ADMIN_ACTIONS: Record<CallAdminAction, readonly CallAdminRelation[]> = {
  cancel: ['ADMIN', 'CREATOR'],
  forceEnd: ['ADMIN', 'CREATOR', 'PARTICIPANT'],
  unlinkTranscript: ['ADMIN', 'CREATOR'],
  regenerateSummary: ['ADMIN', 'CREATOR', 'PARTICIPANT'],
  reprocessTranscript: ['ADMIN', 'CREATOR'],
  changeOwner: ['ADMIN', 'CREATOR'],
};

const CALL_ACTIONS = Object.keys(CALL_ADMIN_ACTIONS) as CallAdminAction[];

const LIVE_STATUSES = new Set<string>([CallStatus.ACTIVE, CallStatus.IN_PROGRESS]);

/** Calls that came FROM a calendar; that calendar owns them, so Xyne may not re-own them. */
export const CALENDAR_CALL_ORIGINS = [
  CallOrigin.GOOGLE_CALENDAR,
  CallOrigin.MICROSOFT_CALENDAR,
] as const;
const CALENDAR_ORIGINS = new Set<string>(CALENDAR_CALL_ORIGINS);

type CallActionState = Pick<Call, 'status' | 'transcript' | 'callOrigin'>;
type SeriesActionState = Pick<RecurringCallSeries, 'status'>;

export class CallAdminError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CallAdminError';
  }
}

/**
 * Why `action` cannot run on the call in its current state, or null when it can.
 * Checked by the endpoints (as a 409) and by `allowedActions`, so a row never
 * offers an action its endpoint would refuse.
 */
function callActionBlockReason(action: CallAdminAction, call: CallActionState): string | null {
  switch (action) {
    case 'cancel':
      return call.status === CallStatus.SCHEDULED ? null : 'Only scheduled calls can be cancelled';
    case 'forceEnd':
      return LIVE_STATUSES.has(call.status) ? null : 'Only live calls can be force-ended';
    case 'unlinkTranscript':
      return call.transcript ? null : 'This call has no linked transcript';
    case 'regenerateSummary':
      return call.transcript ? null : 'This call has no transcript to summarise';
    case 'reprocessTranscript':
      if (call.status !== CallStatus.ENDED) return 'Only ended calls can be reprocessed';
      return call.transcript ? 'This call already has a transcript linked' : null;
    case 'changeOwner':
      return CALENDAR_ORIGINS.has(call.callOrigin)
        ? 'Calendar-synced calls are owned by the external calendar'
        : null;
  }
}

class CallAdminAccessService {
  async getScope(userId: string): Promise<CallAdminScope> {
    return (await hasResourceAdminAccess(db, userId, 'SCRIBE')) ? 'ORG' : 'SELF';
  }

  async getCallRelation(
    call: Pick<Call, 'id' | 'createdByUserId'>,
    userId: string,
    scope: CallAdminScope,
  ): Promise<CallAdminRelation> {
    if (scope === 'ORG') return 'ADMIN';
    if (call.createdByUserId === userId) return 'CREATOR';
    const participant = await repositories.calls.findParticipant(call.id, userId);
    return participant ? 'PARTICIPANT' : 'NONE';
  }

  async getSeriesRelation(
    series: Pick<RecurringCallSeries, 'id' | 'organizerId'>,
    userId: string,
    scope: CallAdminScope,
  ): Promise<CallAdminRelation> {
    if (scope === 'ORG') return 'ADMIN';
    if (series.organizerId === userId) return 'CREATOR';
    const participant = await db.recurringCallParticipant.findFirst({
      where: { recurringSeriesId: series.id, userId },
      select: { id: true },
    });
    return participant ? 'PARTICIPANT' : 'NONE';
  }

  /**
   * Throws unless `relation` may run `action`. A caller with no relation at all gets
   * a 404 rather than a 403, matching what the per-user call ACL answers everywhere
   * else, so the panel doesn't confirm that someone else's call exists.
   */
  assertCan(action: CallAdminAction, relation: CallAdminRelation): void {
    if (relation === 'NONE') throw new CallAdminError('Call not found', 404);
    if (!CALL_ADMIN_ACTIONS[action].includes(relation)) {
      throw new CallAdminError('You do not have permission to perform this action', 403);
    }
  }

  /**
   * Moving a whole series rewrites the series organizer and every future instance, so
   * the caller must be allowed `changeOwner` on the SERIES, not merely on the one call
   * the request named. Owning a single instance is not enough — a single-instance
   * transfer through this panel is exactly what makes an instance's owner diverge from
   * the series organizer, and that owner must not be able to take the rest of the series.
   *
   * 403 rather than the usual 404-for-NONE: the caller can already see the call that
   * points at this series, so refusing tells them nothing they didn't know.
   */
  assertCanChangeSeriesOwner(relation: CallAdminRelation): void {
    if (!CALL_ADMIN_ACTIONS.changeOwner.includes(relation)) {
      throw new CallAdminError('You can only move a whole series if you own it', 403);
    }
  }

  assertApplicable(action: CallAdminAction, call: CallActionState): void {
    const reason = callActionBlockReason(action, call);
    if (reason) throw new CallAdminError(reason, 409);
  }

  allowedActions(relation: CallAdminRelation, call: CallActionState): CallAdminAction[] {
    return CALL_ACTIONS.filter(
      (action) =>
        CALL_ADMIN_ACTIONS[action].includes(relation) && callActionBlockReason(action, call) === null,
    );
  }

  /** Series rows offer only cancellation; ownership moves through a call's `applyToSeries`. */
  assertSeriesCancellable(series: SeriesActionState): void {
    if (series.status !== RecurringCallSeriesStatus.ACTIVE) {
      throw new CallAdminError('Only active series can be cancelled', 409);
    }
  }

  allowedSeriesActions(relation: CallAdminRelation, series: SeriesActionState): CallAdminAction[] {
    return CALL_ADMIN_ACTIONS.cancel.includes(relation) &&
      series.status === RecurringCallSeriesStatus.ACTIVE
      ? ['cancel']
      : [];
  }
}

export const callAdminAccessService = new CallAdminAccessService();
