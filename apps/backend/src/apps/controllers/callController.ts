import { Request, Response, NextFunction } from 'express';
import { scheduleCallController } from '@/controllers/scheduleCallController';
import { callController as nativeCallController } from '@/controllers/callController';
import { repositories } from '@/database/repositories';
import { callShareService } from '@/services/callShareService';
import { transcriptService } from '@/services/transcriptService';
import { convertBlockNoteToMarkdown } from '@/services/canvasService';
import { readFromYSweet } from '@/utils/ysweetUtils';
import { summaryTemplateService } from '@/services/summaryTemplateService';
import { INITIATED_BY_INSTALLED_APP_ID_KEY } from '@/services/callSummaryAppEventService';
import { logger } from '@/utils/logger';

const DEFAULT_START_LEAD_MS = 5 * 60 * 1000;
const DEFAULT_DURATION_MS = 30 * 60 * 1000;

/**
 * `:callId` on every app-facing call route is Call.externalId — the public id
 * POST /schedule returns and the one CALL_SUMMARY_READY carries.
 */
export class AppCallController {

  /**
   * POST /api/apps/calls/schedule — same body as the native schedule route.
   * An optional `summaryTemplateId` pins the template the call's summary is
   * generated with; it must be one the app's own user can access.
   */
  scheduleCall = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const startsAt =
        typeof req.body?.startsAt === 'number'
          ? req.body.startsAt
          : Date.now() + DEFAULT_START_LEAD_MS;
      const endsAt =
        typeof req.body?.endsAt === 'number' ? req.body.endsAt : startsAt + DEFAULT_DURATION_MS;

      req.body.startsAt = startsAt;
      req.body.endsAt = endsAt;

      // Mark the new call as app-owned so its summary is delivered back to this
      // app's webhook when it is ready. ScheduleCallSchema drops unknown body
      // fields, so the id cannot be threaded through the request — capture the
      // created call off the response instead and stamp it here.
      const installedAppId = (req as unknown as { auth?: { installedAppId?: string } }).auth
        ?.installedAppId;
      const created: { callId: string | null } = { callId: null };
      const sendJson = res.json.bind(res);
      res.json = (body: unknown): Response => {
        const payload = body as { success?: boolean; callId?: unknown } | null;
        if (payload?.success === true && typeof payload.callId === 'string') {
          created.callId = payload.callId;
        }
        return sendJson(body);
      };

      await scheduleCallController.scheduleCall(req, res);

      if (created.callId && installedAppId) {
        await this.stampOwningApp(created.callId, installedAppId);
      }
    } catch (error) {
      logger.error('[AppCallController] Failed to schedule call:', error);
      next(error);
    }
  };

  /**
   * GET /api/apps/calls/:callId — call detail plus participants.
   * `scope=metadata` (the default) skips the transcript/summary presence reads.
   */
  getCall = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { callId } = req.params;
    try {
      const call = await this.loadReadableCall(req, res);
      if (!call) return;

      const [participants, hasTranscript] = await Promise.all([
        repositories.calls.findParticipantsForApps(call.externalId),
        transcriptService.transcriptExists(call.externalId),
      ]);

      const metadata =
        call.metadata && typeof call.metadata === 'object' && !Array.isArray(call.metadata)
          ? (call.metadata as Record<string, unknown>)
          : {};
      const summaryCanvasId = metadata.detailedSummaryCanvasId;

      res.json({
        success: true,
        call: {
          callId: call.externalId,
          title: call.title,
          description: call.description,
          status: call.status,
          callType: call.callType,
          callOrigin: call.callOrigin,
          channelId: call.channelId,
          createdByUserId: call.createdByUserId,
          organizerId: call.organizerId,
          roomLink: call.roomLink,
          scheduledStartsAt: call.startsAt?.toISOString() ?? null,
          scheduledEndsAt: call.endsAt?.toISOString() ?? null,
          timezone: call.timezone,
          startedAt: call.startedAt?.toISOString() ?? null,
          endedAt: call.endedAt?.toISOString() ?? null,
          durationSeconds: this.durationSeconds(call.startedAt, call.endedAt),
          summaryTemplateId: call.summaryTemplateId,
          hasTranscript,
          // 'ready' | 'pending' | 'failed' on the note-taker path; regular calls
          // only ever get the canvas pointer, so presence is the signal there.
          summaryStatus:
            typeof metadata.detailedSummaryStatus === 'string'
              ? metadata.detailedSummaryStatus
              : typeof summaryCanvasId === 'string'
                ? 'ready'
                : null,
          detailedSummaryCanvasId: typeof summaryCanvasId === 'string' ? summaryCanvasId : null,
          participants: participants.map(participant => ({
            ...participant,
            joinedAt: participant.joinedAt?.toISOString() ?? null,
            leftAt: participant.leftAt?.toISOString() ?? null,
          })),
        },
      });
    } catch (error) {
      logger.error(`[AppCallController] [${callId}] Failed to get call:`, error);
      next(error);
    }
  };

  /**
   * GET /api/apps/calls/:callId/transcript — the transcript as JSON.
   * The native route streams a .txt attachment, which is the wrong shape for
   * an app, so the text is returned inline here.
   */
  getTranscript = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { callId } = req.params;
    try {
      const call = await this.loadReadableCall(req, res);
      if (!call) return;

      if (!(await callShareService.canViewRecordings(call, req.user!.id))) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }

      const transcript = await transcriptService.getTranscriptContent(call.externalId);
      if (transcript === null) {
        res.status(404).json({ success: false, error: 'Transcript not available for this call' });
        return;
      }

      res.json({ success: true, callId: call.externalId, transcript });
    } catch (error) {
      logger.error(`[AppCallController] [${callId}] Failed to get transcript:`, error);
      next(error);
    }
  };

  /**
   * GET /api/apps/calls/:callId/summary — the detailed summary as Markdown.
   * The pull counterpart of CALL_SUMMARY_READY, for apps that missed the
   * webhook or did not schedule the call. Answers 404 until a summary exists;
   * `summaryStatus` tells a 'pending' summary apart from a 'failed' one.
   */
  getSummary = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { callId } = req.params;
    try {
      const call = await this.loadReadableCall(req, res);
      if (!call) return;

      if (!(await callShareService.canViewRecordings(call, req.user!.id))) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }

      const metadata =
        call.metadata && typeof call.metadata === 'object' && !Array.isArray(call.metadata)
          ? (call.metadata as Record<string, unknown>)
          : {};
      const canvasId =
        typeof metadata.detailedSummaryCanvasId === 'string' && metadata.detailedSummaryCanvasId
          ? metadata.detailedSummaryCanvasId
          : null;
      const summaryStatus =
        typeof metadata.detailedSummaryStatus === 'string'
          ? metadata.detailedSummaryStatus
          : canvasId
            ? 'ready'
            : null;

      const summary = canvasId ? await this.readSummaryCanvas(canvasId, call.workspaceId, req.user!.id) : null;
      if (!summary?.trim()) {
        res.status(404).json({
          success: false,
          error: 'Summary not available for this call',
          summaryStatus,
        });
        return;
      }

      res.json({
        success: true,
        callId: call.externalId,
        summaryStatus,
        summaryTemplateId: call.summaryTemplateId,
        detailedSummaryCanvasId: canvasId,
        detailedSummary: summary,
      });
    } catch (error) {
      logger.error(`[AppCallController] [${callId}] Failed to get summary:`, error);
      next(error);
    }
  };

  /**
   * POST /api/apps/calls/:callId/regenerate-summary
   * Asynchronous by design: answers 202 and the finished summary arrives as a
   * CALL_SUMMARY_READY webhook. Body: { summaryTemplateId, modelType? }.
   */
  regenerateSummary = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await nativeCallController.regenerateRecordingSummary(req, res);
    } catch (error) {
      logger.error(
        `[AppCallController] [${req.params.callId}] Failed to regenerate summary:`,
        error,
      );
      next(error);
    }
  };

  /**
   * PATCH /api/apps/calls/:callId — edit a scheduled call (title, times,
   * invitees, summaryTemplateId). Only SCHEDULED calls may be edited.
   */
  updateScheduledCall = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await scheduleCallController.updateScheduledCall(req, res);
    } catch (error) {
      logger.error(
        `[AppCallController] [${req.params.callId}] Failed to update scheduled call:`,
        error,
      );
      next(error);
    }
  };

  /**
   * GET /api/apps/calls/summary-templates — every template visible to the
   * installing user: their own, workspace-public, and explicitly shared ones.
   *
   * Summary rows only. The prompt bodies (systemPrompt, sections,
   * autoTriggerPrompt) are returned by the single-template route, so a list of
   * every visible template does not hand out every prompt in the workspace.
   */
  listSummaryTemplates = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const templates = await summaryTemplateService.list(req.user!.workspaceId, req.user!.id);
      res.json({
        success: true,
        templates: templates.map(template => ({
          id: template.id,
          name: template.name,
          visibility: template.visibility,
          defaultOutlet: template.defaultOutlet,
          version: template.version,
          sectionCount: Array.isArray(template.sections) ? template.sections.length : 0,
          createdBy: template.createdBy,
          createdAt: template.createdAt,
          canEdit: template.canEdit,
          isSystem: template.isSystem,
        })),
      });
    } catch (error) {
      logger.error('[AppCallController] Failed to list summary templates:', error);
      next(error);
    }
  };

  /**
   * GET /api/apps/calls/summary-templates/:templateId — full template detail,
   * including the generated system prompt and section definitions. This is the
   * only route that returns them; the list route stays summary-only.
   */
  getSummaryTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { templateId } = req.params;
    try {
      const template = await summaryTemplateService.findAccessibleById(
        templateId,
        req.user!.workspaceId,
        req.user!.id,
      );
      if (!template) {
        res.status(404).json({ success: false, error: 'Summary template not found' });
        return;
      }
      res.json({ success: true, template });
    } catch (error) {
      logger.error(`[AppCallController] [${templateId}] Failed to get summary template:`, error);
      next(error);
    }
  };

  /**
   * Resolves :callId and applies the same read check the native call-detail
   * route uses. Writes the error response itself and answers null when the
   * caller may not read the call.
   */
  private async loadReadableCall(req: Request, res: Response) {
    const { callId } = req.params;
    if (!callId) {
      res.status(400).json({ success: false, error: 'callId is required' });
      return null;
    }

    const call = await repositories.calls.findByExternalId(callId);
    if (!call || (call.workspaceId !== null && call.workspaceId !== req.user!.workspaceId)) {
      res.status(404).json({ success: false, error: 'Call not found' });
      return null;
    }

    const canView = await callShareService.hasAtLeast(
      call,
      req.user!.id,
      req.user!.workspaceId,
      'view',
    );
    if (!canView) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return null;
    }

    return call;
  }

  /**
   * Reads a summary canvas as Markdown: live Y-Sweet content first, falling
   * back to the persisted canvas.content snapshot when Y-Sweet has nothing.
   */
  private async readSummaryCanvas(
    canvasId: string,
    workspaceId: string | null,
    userId: string,
  ): Promise<string | null> {
    const canvas = await repositories.calls.findSummaryCanvas(canvasId, workspaceId);
    if (!canvas) return null;

    const ySweetBlocks = await readFromYSweet(canvas.id, userId);
    const storedBlocks = Array.isArray(canvas.content) ? canvas.content : [];
    const blocks = ySweetBlocks.length > 0 ? ySweetBlocks : storedBlocks;
    return blocks.length > 0 ? convertBlockNoteToMarkdown(blocks) : null;
  }

  /** Merge-writes the owning app id onto Call.metadata. */
  private async stampOwningApp(callId: string, installedAppId: string): Promise<void> {
    try {
      const call = await repositories.calls.findById(callId);
      if (!call) return;
      const metadata =
        call.metadata && typeof call.metadata === 'object' && !Array.isArray(call.metadata)
          ? (call.metadata as Record<string, unknown>)
          : {};
      await repositories.calls.update(call.id, {
        metadata: { ...metadata, [INITIATED_BY_INSTALLED_APP_ID_KEY]: installedAppId },
      });
    } catch (error) {
      // The call itself was created and answered for. Losing the stamp only
      // costs this app its CALL_SUMMARY_READY event, so log loudly and move on.
      logger.error(
        `[AppCallController] [${callId}] Failed to stamp owning app ${installedAppId}:`,
        error,
      );
    }
  }

  private durationSeconds(startedAt: Date | null, endedAt: Date | null): number | null {
    if (!startedAt || !endedAt) return null;
    const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
    return ms > 0 ? Math.round(ms / 1000) : null;
  }
}
