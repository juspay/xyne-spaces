import type { Request, Response } from 'express';
import type { Call } from '@prisma/client';
import { ZodError } from 'zod';
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
  CallAdminRegenerateSummarySchema,
} from '@/validators/callValidator';

type CallActionResult = { status?: number; body?: Record<string, unknown> } | void;

/** One structured line per admin mutation — the audit trail until the audit tab lands. */
function logAdminAction(
  targetId: string,
  action: string,
  actor: CallAdminActor,
  relation: CallAdminRelation,
): void {
  logger.info(
    `[${targetId}] call_admin_action | action=${action}, actor=${actor.userId}, scope=${actor.scope}, relation=${relation}`,
  );
}

/**
 * The other half of that trail. A panel every workspace member can reach needs the
 * refused attempts too, not just the ones that went through — a 403/404 says someone
 * reached for a call that isn't theirs, which is the part worth being able to look up.
 */
function logAdminDenial(
  targetId: string,
  action: string,
  actor: CallAdminActor | null,
  error: CallAdminError,
): void {
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
        logAdminAction(call.externalId, action, actor, relation);
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
        ownerId: query.ownerId,
        search: query.search,
        summaryStatuses: query.summaryStatus,
        hasTranscript: query.hasTranscript,
        from: query.from,
        to: query.to,
        limit: query.limit,
        cursor: query.cursor,
      });
      res.json({ success: true, scope: actor.scope, rows, nextCursor, hasMore: nextCursor !== null });
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
        organizerId: query.organizerId,
        search: query.search,
        limit: query.limit,
        cursor: query.cursor,
      });
      res.json({ success: true, scope: actor.scope, rows, nextCursor, hasMore: nextCursor !== null });
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
    async (call, _actor, req) => {
      const input = CallAdminRegenerateSummarySchema.parse(req.body ?? {});
      await callAdminService.regenerateSummary(call, input);
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

    if (input.applyToSeries) {
      if (!call.recurringSeriesId) {
        throw new CallAdminError('This call is not part of a recurring series', 400);
      }
      const { relation: seriesRelation } = await callAdminService.resolveSeries(
        actor,
        call.recurringSeriesId,
      );
      callAdminAccessService.assertCanChangeSeriesOwner(seriesRelation);
    }

    const result = await callAdminService.transferOwnership(call, input.newOwnerUserId, input.applyToSeries);
    return { body: { ...result } };
  });
}

export const callAdminController = new CallAdminController();
