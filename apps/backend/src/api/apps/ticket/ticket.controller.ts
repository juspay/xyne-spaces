import { api } from '@xyne/shared';
import { appPermission } from '@/apps/access';
import { repositories } from '@/database/repositories';
import { ContractError, controller } from '@/framework/api';
import { extractEmailAddress } from '@/utils/email';
import { logger } from '@/utils/logger';
import { prismaClient } from '../../../apps/controllers/ticketController';
import { decodeCursor, paginateResults } from '../../../apps/core/paginationUtils';
import { validateChannelIdsAccess } from '../../../apps/middelware/channelValidation';
import type { MerchantTicketListItem } from '../../../apps/types';
import { requireUser } from '../calls-tickets.helpers';

const workspaceRequired = () => new ContractError(400, { error: 'Authenticated workspace is required', code: 'VALIDATION_ERROR' });
const internalError = () => new ContractError(500, { error: 'Internal server error', code: 'INTERNAL_ERROR' });

/** GET /apps/ticket/boards */
export const listBoards = controller(api.apps.ticket.boards, { checks: { permission: appPermission('tickets:read') } }, async (input) => {
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
});

/** GET /apps/ticket/boards/:boardId/stages */
export const listBoardStages = controller(api.apps.ticket.boardStages, { checks: { permission: appPermission('tickets:read') } }, async (input) => {
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
});

interface MerchantTicketsListCursor {
  id: string;
  createdAt: number;
}

/** GET /apps/ticket/listBySender: a sender's tickets in channels the bot is in. */
export const listBySender = controller(api.apps.ticket.listBySender, { checks: { permission: appPermission('tickets:read') } }, async (input) => {
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
});