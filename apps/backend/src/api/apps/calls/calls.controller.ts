import { repositories } from '@/database/repositories';
import { ContractError } from '@/framework/api';
import { callShareService } from '@/services/callShareService';
import { transcriptService } from '@/services/transcriptService';
import { summaryTemplateService } from '@/services/summaryTemplateService';
import type { AuthenticatedUser } from '@/types/express';
import { isTranscriptUnlinked } from '@/utils/transcriptUnlink';
import { logger } from '@/utils/logger';
import { requireUser } from '../calls-tickets.helpers';

/** GET /apps/calls/:callId: call detail plus participants, behind the native read check. */
export async function getCall(input: { params: { callId: string }; user: AuthenticatedUser | undefined }) {
  const user = requireUser(input.user);
  const { callId } = input.params;
  try {
    const call = await repositories.calls.findByExternalId(callId);
    if (!call || (call.workspaceId !== null && call.workspaceId !== user.workspaceId)) {
      throw new ContractError(404, { success: false, error: 'Call not found' });
    }
    if (!(await callShareService.hasAtLeast(call, user.id, user.workspaceId, 'view'))) {
      throw new ContractError(403, { success: false, error: 'Access denied' });
    }

    const [participants, hasTranscript] = await Promise.all([
      repositories.calls.findParticipantsForApps(call.externalId),
      // An admin-unlinked transcript still sits in storage; report it as absent.
      isTranscriptUnlinked(call) ? false : transcriptService.transcriptExists(call.externalId),
    ]);
    const metadata =
      call.metadata && typeof call.metadata === 'object' && !Array.isArray(call.metadata) ? (call.metadata as Record<string, unknown>) : {};
    const summaryCanvasId = metadata.detailedSummaryCanvasId;
    const durationSeconds =
      call.startedAt && call.endedAt
        ? (() => {
            const ms = new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime();
            return ms > 0 ? Math.round(ms / 1000) : null;
          })()
        : null;

    return {
      success: true as const,
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
        durationSeconds,
        summaryTemplateId: call.summaryTemplateId,
        hasTranscript,
        // 'ready' | 'pending' | 'failed' on the note-taker path; regular calls only ever get the
        // canvas pointer, so presence is the signal there.
        summaryStatus:
          typeof metadata.detailedSummaryStatus === 'string'
            ? metadata.detailedSummaryStatus
            : typeof summaryCanvasId === 'string'
              ? 'ready'
              : null,
        detailedSummaryCanvasId: typeof summaryCanvasId === 'string' ? summaryCanvasId : null,
        participants: participants.map((participant) => ({
          ...participant,
          joinedAt: participant.joinedAt?.toISOString() ?? null,
          leftAt: participant.leftAt?.toISOString() ?? null,
        })),
      },
    };
  } catch (error) {
    if (!(error instanceof ContractError)) logger.error(`[AppCallController] [${callId}] Failed to get call:`, error);
    throw error;
  }
}

/** GET /apps/calls/summary-templates: summary rows only (prompt bodies come from the single-template route). */
export async function listSummaryTemplates(input: { user: AuthenticatedUser | undefined }) {
  const user = requireUser(input.user);
  try {
    const templates = await summaryTemplateService.list(user.workspaceId, user.id);
    return {
      success: true as const,
      templates: templates.map((template) => ({
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
    };
  } catch (error) {
    logger.error('[AppCallController] Failed to list summary templates:', error);
    throw error;
  }
}

/** GET /apps/calls/summary-templates/:templateId: full template detail. */
export async function getSummaryTemplate(input: { params: { templateId: string }; user: AuthenticatedUser | undefined }) {
  const user = requireUser(input.user);
  const { templateId } = input.params;
  try {
    const template = await summaryTemplateService.findAccessibleById(templateId, user.workspaceId, user.id);
    if (!template) throw new ContractError(404, { success: false, error: 'Summary template not found' });
    return { success: true as const, template };
  } catch (error) {
    if (!(error instanceof ContractError)) logger.error(`[AppCallController] [${templateId}] Failed to get summary template:`, error);
    throw error;
  }
}