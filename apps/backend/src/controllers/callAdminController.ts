import type { Request, Response } from 'express';
import type { Call } from '@prisma/client';
import { ZodError } from 'zod';
import { WorkspaceRole } from '@xyne/shared';
import { logger } from '@/utils/logger';
import {
  CallAdminError,
  callAdminAccessService,
  type CallAdminAction,
  type CallAdminRelation,
} from '@/services/callAdminAccessService';
import { callAdminService, type CallAdminActor } from '@/services/callAdminService';
import {
  CallAdminChangeOwnerSchema,
  CallAdminListCallsQuerySchema,
  CallAdminListSeriesQuerySchema,
} from '@/validators/callValidator';

/** `audit` is appended to the action's log line, for details the action/actor pair can't show. */
type CallActionResult = { status?: number; body?: Record<string, unknown>; audit?: string } | void;

/** One structured line per admin mutation — the audit trail until the audit tab lands. */
function logAdminAction(
  targetId: string,
  action: string,
  actor: CallAdminActor,
  relation: CallAdminRelation,
  audit?: string,
): void {
  logger.info(
    `[${targetId}] call_admin_action | action=${action}, actor=${actor.userId}, scope=${actor.scope}, relation=${relation}${audit ? `, ${audit}` : ''}`,
  );
}

/**
 * The other half of that trail. A panel every workspace member can reach needs the
 * refused attempts too, not just the ones that went through — a 403/404 says someone
 * reached for a call that isn't theirs, which is the part worth being able to look up.
 * Only those count: a 409 (wrong state) or 400 (bad input) is not a refusal.
 */
function logAdminDenial(
  targetId: string,
  action: string,
  actor: CallAdminActor | null,
  error: CallAdminError,
): void {
  if (error.status !== 403 && error.status !== 404) return;
  logger.warn(
    `[${targetId}] call_admin_action_denied | action=${action}, actor=${actor?.userId ?? 'unknown'}, scope=${actor?.scope ?? 'unknown'}, status=${error.status}, reason=${error.message}`,
  );
}

/**
 * /api/calls/admin — the calls admin panel. Mounted workspace-scoped, so the
 * per-user call ACL does not apply here: every handler resolves the caller's
 * relation to the call and asserts it against callAdminAccessService instead.
 */
export class CallAdminController {
  private async resolveActor(req: Request, res: Response): Promise<CallAdminActor | null> {
    const user = req.user;
    if (!user?.id || !user.workspaceId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return null;
    }
    // Guests are limited to the channels they can currently access (CallsACL), which this
    // panel's relation checks don't model, so they don't get the panel at all.
    if (user.role === WorkspaceRole.GUEST) {
      res.status(403).json({ success: false, error: 'Guests cannot use the calls admin panel' });
      return null;
    }
    const scope = await callAdminAccessService.getScope(user.id);
    return { userId: user.id, workspaceId: user.workspaceId, scope };
  }

  private handleError(res: Response, error: unknown, failureMessage: string, targetId?: string): void {
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: error.errors[0]?.message ?? 'Invalid request' });
      return;
    }
    if (error instanceof CallAdminError) {
      res.status(error.status).json({ success: false, error: error.message, ...error.details });
      return;
    }
    logger.error(`[${targetId ?? 'call_admin'}] call_admin_request_failed`, {
      error,
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ success: false, error: failureMessage });
  }

  /**
   * Shared shape of every per-call action: resolve the call in the caller's workspace,
   * check the relation may run `action` and the call's state allows it, run it, log it.
   */
  private callAction(
    action: CallAdminAction,
    failureMessage: string,
    run: (call: Call, actor: CallAdminActor, req: Request) => Promise<CallActionResult>,
  ) {
    return async (req: Request, res: Response): Promise<void> => {
      const { callId } = req.params;
      // Hoisted so a refusal can still name who was asking.
      let actor: CallAdminActor | null = null;
      try {
        actor = await this.resolveActor(req, res);
        if (!actor) return;

        const { call, relation } = await callAdminService.resolveCall(actor, callId);
        callAdminAccessService.assertCan(action, relation);
        callAdminAccessService.assertApplicable(action, call);

        const result = await run(call, actor, req);
        logAdminAction(call.externalId, action, actor, relation, result?.audit);
        res.status(result?.status ?? 200).json({ success: true, ...result?.body });
      } catch (error) {
        if (error instanceof CallAdminError) logAdminDenial(callId, action, actor, error);
        this.handleError(res, error, failureMessage, callId);
      }
    };
  }

  /** GET /api/calls/admin/calls */
  listCalls = async (req: Request, res: Response): Promise<void> => {
    try {
      const actor = await this.resolveActor(req, res);
      if (!actor) return;

      const query = CallAdminListCallsQuerySchema.parse(req.query);
      if (query.scope === 'all' && actor.scope !== 'ORG') {
        res.status(403).json({ success: false, error: 'Scribe admin access is required to see every call' });
        return;
      }

      const { rows, nextCursor } = await callAdminService.listCalls(actor, {
        mineOnly: query.scope === 'mine',
        statuses: query.status,
        callType: query.type,
        search: query.search,
        summaryStatuses: query.summaryStatus,
        hasTranscript: query.hasTranscript,
        limit: query.limit,
        cursor: query.cursor,
      });
      res.json({ success: true, rows, nextCursor });
    } catch (error) {
      this.handleError(res, error, 'Failed to list calls');
    }
  };

  /** GET /api/calls/admin/series */
  listSeries = async (req: Request, res: Response): Promise<void> => {
    try {
      const actor = await this.resolveActor(req, res);
      if (!actor) return;

      const query = CallAdminListSeriesQuerySchema.parse(req.query);
      if (query.scope === 'all' && actor.scope !== 'ORG') {
        res.status(403).json({ success: false, error: 'Scribe admin access is required to see every series' });
        return;
      }

      const { rows, nextCursor } = await callAdminService.listSeries(actor, {
        mineOnly: query.scope === 'mine',
        statuses: query.status,
        search: query.search,
        limit: query.limit,
        cursor: query.cursor,
      });
      res.json({ success: true, rows, nextCursor });
    } catch (error) {
      this.handleError(res, error, 'Failed to list recurring series');
    }
  };

  /** POST /api/calls/admin/series/:seriesId/cancel — soft cancel of the series and its future instances. */
  cancelSeries = async (req: Request, res: Response): Promise<void> => {
    const { seriesId } = req.params;
    let actor: CallAdminActor | null = null;
    try {
      actor = await this.resolveActor(req, res);
      if (!actor) return;

      const { series, relation } = await callAdminService.resolveSeries(actor, seriesId);
      callAdminAccessService.assertCan('cancel', relation);
      callAdminAccessService.assertSeriesCancellable(series);

      const { cancelledCalls } = await callAdminService.cancelSeries(series);
      logAdminAction(series.id, 'cancelSeries', actor, relation);
      res.json({ success: true, cancelledCalls });
    } catch (error) {
      if (error instanceof CallAdminError) logAdminDenial(seriesId, 'cancelSeries', actor, error);
      this.handleError(res, error, 'Failed to cancel series', seriesId);
    }
  };

  /** POST /api/calls/admin/calls/:callId/cancel — a single SCHEDULED call or instance. */
  cancelCall = this.callAction('cancel', 'Failed to cancel call', async (call) => {
    await callAdminService.cancelCall(call);
  });

  /** POST /api/calls/admin/calls/:callId/force-end — 409 while the LiveKit room still exists. */
  forceEnd = this.callAction('forceEnd', 'Failed to end call', async (call) => {
    await callAdminService.forceEnd(call);
  });

  /** POST /api/calls/admin/calls/:callId/unlink-transcript — storage files are kept. */
  unlinkTranscript = this.callAction(
    'unlinkTranscript',
    'Failed to unlink transcript',
    async (call, actor) => {
      await callAdminService.unlinkTranscript(call, actor.userId);
    },
  );

  /** POST /api/calls/admin/calls/:callId/reprocess-transcript — 202, runs in the background. */
  reprocessTranscript = this.callAction(
    'reprocessTranscript',
    'Failed to reprocess transcript',
    async (call) => {
      await callAdminService.reprocessTranscript(call);
      return { status: 202 };
    },
  );

  /** POST /api/calls/admin/calls/:callId/regenerate-summary — 202 once marked pending. */
  regenerateSummary = this.callAction(
    'regenerateSummary',
    'Failed to start summary regeneration',
    async (call) => {
      await callAdminService.regenerateSummary(call);
      return { status: 202, body: { status: 'pending' } };
    },
  );

  /**
   * POST /api/calls/admin/calls/:callId/owner
   *
   * `applyToSeries` writes rows beyond the call the wrapper just checked — the series
   * organizer and every future instance, which may belong to other people — so the
   * caller's relation to the SERIES is asserted before any of that is touched.
   */
  changeOwner = this.callAction('changeOwner', 'Failed to change owner', async (call, actor, req) => {
    const input = CallAdminChangeOwnerSchema.parse(req.body);

    let seriesOrganizerId: string | null = null;
    if (input.applyToSeries) {
      if (!call.recurringSeriesId) {
        throw new CallAdminError('This call is not part of a recurring series', 400);
      }
      const { series, relation: seriesRelation } = await callAdminService.resolveSeries(
        actor,
        call.recurringSeriesId,
      );
      callAdminAccessService.assertCanChangeSeriesOwner(seriesRelation);
      seriesOrganizerId = series.organizerId;
    }

    // Ownership grants read access to the transcript, so an admin must not be able to
    // take a call for themselves. Re-asserting something you already own stays allowed.
    const alreadyOwner =
      call.createdByUserId === actor.userId && (!input.applyToSeries || seriesOrganizerId === actor.userId);
    if (input.newOwnerUserId === actor.userId && !alreadyOwner) {
      throw new CallAdminError('You cannot transfer ownership to yourself', 403);
    }

    const result = await callAdminService.transferOwnership(
      call,
      input.newOwnerUserId,
      input.applyToSeries,
      actor.userId,
    );
    return {
      body: { ...result },
      audit: `previousOwner=${call.createdByUserId}, newOwner=${input.newOwnerUserId}, applyToSeries=${input.applyToSeries}, transferredCalls=${result.transferredCallIds.length}`,
    };
  });
}

export const callAdminController = new CallAdminController();
