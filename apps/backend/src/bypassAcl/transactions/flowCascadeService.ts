import { transaction } from '../base';
import { db } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { ticketRepository } from '@/services/flowCascadeService';
import { type FlowPlanNode, type FlowRunNodeSnapshot, TicketStatusV2, FLOW_STAGE_NAMES, TicketPriority, MessageType } from '@xyne/shared';
import { v5 as uuidv5 } from 'uuid';
import { generateTicketId } from '@/bypassAcl/transactions/ticketIdService';
import { lockTicketStatusV2 } from '@/bypassAcl/rowLockServices';


export function createFlowStepTicketTx(requireActiveRoot: boolean | undefined, rootTicketId: string, node: FlowPlanNode, rootTicket: { boardId: string; projectId: string; channelId: string; workspaceId: string; }, actorUserId: string, deterministicTicketId: string, nodeSnapshot: FlowRunNodeSnapshot) {
  return transaction(['Board', 'Conversation', 'ConversationParticipant', 'Message', 'Project', 'Stage', 'StageTransition', 'Ticket', 'TicketStageEta'], 'createFlowStepTicket: conversation, ticket, message and participant writes must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    if (requireActiveRoot) {
      const lockedRoot = await lockTicketStatusV2(tx, rootTicketId);
      if (lockedRoot?.statusV2 !== TicketStatusV2.STARTED) {
        throw new AppError('Only an active Flow run can move a group to backlog', 409);
      }
    }
    const conversationId = uuidv5(
      `flow-conversation:${rootTicketId}:${node.id}`,
      '98175b0b-310d-50de-852f-0f6df9be4c30'
    );
    const initialMessageId = uuidv5(
      `flow-message:${rootTicketId}:${node.id}`,
      '98175b0b-310d-50de-852f-0f6df9be4c30'
    );
    await tx.conversation.create({
      data: {
        conversationId,
        workspaceId: rootTicket.workspaceId,
        channelId: rootTicket.channelId,
        createdBy: actorUserId,
        initialMessageId,
        pinned: false,
        doNotPostToChannel: false,
      },
    });
    const xyneId = await generateTicketId(tx, rootTicket.projectId);
    const created = await ticketRepository.createTicket(
      {
        id: deterministicTicketId,
        title: node.title,
        description: node.description || node.title,
        createdBy: actorUserId,
        updatedBy: actorUserId,
        conversationId,
        channelId: rootTicket.channelId,
        projectId: rootTicket.projectId,
        workspaceId: rootTicket.workspaceId,
        boardId: rootTicket.boardId,
        statusV2: TicketStatusV2.TODO,
        stageName: FLOW_STAGE_NAMES.TODO,
        priority: TicketPriority.LOW,
        xyneId,
        ...(node.assignedTo && { assignedTo: node.assignedTo }),
        rootId: rootTicketId,
        metadata: { flow: { planNodeId: node.id, rootTicketId, nodeSnapshot } },
      },
      tx
    );
    await tx.message.create({
      data: {
        messageId: initialMessageId,
        conversationId,
        workspaceId: rootTicket.workspaceId,
        senderId: actorUserId,
        content: `Flow step created: ${node.title}`,
        msgType: MessageType.SYSTEM,
        hasAttachment: false,
        edited: false,
        isDeleted: false,
        isSent: true,
        showInChannel: true,
        createdAt: new Date(),
        metadata: { ticketId: created.id },
      },
    });
    await tx.conversation.update({
      where: { conversationId },
      data: { ticketId: created.id },
    });
    await tx.conversationParticipant.upsert({
      where: { conversationId_userId: { conversationId, userId: actorUserId } },
      create: {
        id: uuidv5(
          `flow-participant:${conversationId}:${actorUserId}`,
          '98175b0b-310d-50de-852f-0f6df9be4c30'
        ),
        conversationId,
        workspaceId: rootTicket.workspaceId,
        userId: actorUserId,
        participationType: 'MENTIONED',
        isSubscribed: true,
        joinedAt: new Date(),
        channelId: rootTicket.channelId,
      },
      update: { participationType: 'MENTIONED', isSubscribed: true },
    });
    return created;
  });
}
