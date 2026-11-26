import { repositories } from '@/database/repositories';
import { ContractError } from '@/framework/api';
import { callShareService } from '@/services/callShareService';
import { transcriptService } from '@/services/transcriptService';
import { summaryTemplateService } from '@/services/summaryTemplateService';
import type { AuthenticatedUser } from '@/types/express';
import { extractEmailAddress } from '@/utils/email';
import { isTranscriptUnlinked } from '@/utils/transcriptUnlink';
import { logger } from '@/utils/logger';
import { prismaClient } from '../controllers/ticketController';
import { decodeCursor, paginateResults } from '../core/paginationUtils';
import { validateChannelIdsAccess } from '../middelware/channelValidation';
import type { MerchantTicketListItem } from '../types';

/**
 * Xyne Apps call and ticket reads on the typed framework: no req/res, same answers as the
 * controller methods they replace (AppCallController.getCall / listSummaryTemplates /
 * getSummaryTemplate, TicketController.listBoards / listBoardStages / listBySender).
 * Unexpected errors go to the app's error handler, as the call controller's next(error) did.
 */

function requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) throw new ContractError(401, { error: 'Unauthorized' });
  return user;
}

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

const workspaceRequired = () => new ContractError(400, { error: 'Authenticated workspace is required', code: 'VALIDATION_ERROR' });
const internalError = () => new ContractError(500, { error: 'Internal server error', code: 'INTERNAL_ERROR' });

/** GET /apps/ticket/boards */
export async function listBoards(input: { query: { projectId?: string }; user: AuthenticatedUser | undefined }) {
  const workspaceId = input.user?.workspaceId;
  if (!workspaceId) throw workspaceRequired();
  try {
    const { projectId } = input.query;
    const boards = await prismaClient.board.findMany({
      where: { workspaceId, ...(projectId ? { projectId } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, boardType: true, description: true, projectId: true, createdAt: true, updatedAt: true },
    });
    return {
      boards: boards.map((board) => ({
        boardId: board.id,
        name: board.name,
        boardType: board.boardType,
        description: board.description,
        projectId: board.projectId,
        createdAt: board.createdAt,
        updatedAt: board.updatedAt,
      })),
    };
  } catch (error) {
    logger.error('[TicketController] listBoards error:', error);
    throw internalError();
  }
}

/** GET /apps/ticket/boards/:boardId/stages */
export async function listBoardStages(input: { params: { boardId: string }; user: AuthenticatedUser | undefined }) {
  const workspaceId = input.user?.workspaceId;
  if (!workspaceId) throw workspaceRequired();
  const { boardId } = input.params;
  try {
    const board = await prismaClient.board.findFirst({ where: { id: boardId, workspaceId }, select: { id: true, name: true, projectId: true } });
    if (!board) throw new ContractError(404, { error: `Board with ID ${boardId} not found`, code: 'BOARD_NOT_FOUND' });
    const stages = await prismaClient.stage.findMany({
      where: { boardId },
      orderBy: [{ sequenceNumber: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, sequenceNumber: true, eta: true, defaultTicketStatusV2: true },
    });
    return {
      boardId: board.id,
      boardName: board.name,
      projectId: board.projectId,
      stages: stages.map((stage) => ({
        stageId: stage.id,
        name: stage.name,
        sequenceNumber: stage.sequenceNumber,
        eta: stage.eta,
        defaultTicketStatusV2: stage.defaultTicketStatusV2,
      })),
    };
  } catch (error) {
    if (error instanceof ContractError) throw error;
    logger.error('[TicketController] listBoardStages error:', error);
    throw internalError();
  }
}

interface MerchantTicketsListCursor {
  id: string;
  createdAt: number;
}

/** GET /apps/ticket/listBySender: a sender's tickets in channels the bot is in. */
export async function listBySender(input: {
  query: { channelIds: string[]; senderEmail: string; limit: number; cursor?: string };
  user: AuthenticatedUser | undefined;
}) {
  const user = requireUser(input.user);
  const { channelIds, senderEmail, limit: rawLimit, cursor } = input.query;
  try {
    const limit = Math.min(Math.max(rawLimit, 1), 100);
    const decodedCursor = decodeCursor<MerchantTicketsListCursor>(cursor);

    const access = await validateChannelIdsAccess(channelIds, user.id);
    if (!access.ok) throw new ContractError(access.status, { error: access.error, message: access.message });

    const normalizedSender = extractEmailAddress(senderEmail) ?? senderEmail.trim().toLowerCase();
    const tickets = await repositories.tickets.findTicketsByMerchantSenderEmail({
      channelIds,
      senderEmail: normalizedSender,
      limit,
      cursor: decodedCursor ? { id: decodedCursor.id, createdAt: new Date(decodedCursor.createdAt) } : undefined,
    });

    const items: MerchantTicketListItem[] = tickets.map((ticket) => {
      const metadata = ticket.metadata as { reporterEmail?: string } | null;
      return {
        ticketId: ticket.id,
        xyneId: ticket.xyneId,
        title: ticket.title,
        statusV2: ticket.statusV2,
        stageName: ticket.stageName,
        priority: ticket.priority,
        createdAt: ticket.createdAt,
        lastEmailAt: ticket.lastEmailAt,
        conversationId: ticket.conversationId,
        channelId: ticket.channelId,
        senderEmail: metadata?.reporterEmail ?? normalizedSender,
      };
    });
    const pagination = paginateResults(items, limit, (item): MerchantTicketsListCursor => ({ id: item.ticketId, createdAt: item.createdAt.getTime() }));
    return { items: pagination.items as unknown as Record<string, unknown>[], nextCursor: pagination.nextCursor, hasMore: pagination.hasMore };
  } catch (error) {
    if (error instanceof ContractError) throw error;
    logger.error('[TicketController] listBySender error:', error);
    if (error instanceof Error && error.message === 'Invalid cursor format') {
      throw new ContractError(400, { error: error.message, code: 'VALIDATION_ERROR' });
    }
    throw internalError();
  }
}
