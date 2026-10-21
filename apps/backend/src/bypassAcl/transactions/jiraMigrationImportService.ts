import { transaction } from '../base';
import { JiraIssue, JiraUser, db, mapPriority, mapJiraIssueTypeToTicketType, JiraMigrationImportService } from '@/services/jiraMigrationImportService';
import { TicketStatusV2, MessageType, buildInitialMessageMd, type InitialMessageSummary, ConversationParticipation, serializeTicketMd, type TicketCardSummary, MessageDirection, ExternalEntityType } from '@xyne/shared';
import { randomUUID } from 'crypto';
import { generateTicketId } from '@/bypassAcl/transactions/ticketIdService';


export function processIssuesChunkTx(generatedConversationId: string, channel: any, resolvedReporterId: string, initialMessageId: string, workspaceId: string, createdAt: Date, initialTicketMessageSenderId: any, rootMessageContent: string, project: any, issue: JiraIssue, self: JiraMigrationImportService, summary: any, description: string, fallbackUserId: any, assignee: JiraUser | undefined, resolvedAssigneeId: string, board: any, stageMatch: { stageName: string; statusV2: TicketStatusV2; }, externalSourceId: string) {
  return transaction(['Board', 'Conversation', 'ConversationParticipant', 'ExternalMessage', 'Message', 'Project', 'Stage', 'StageTransition', 'Ticket', 'TicketStageEta'], 'processIssuesChunk: conversation, message, ticket and external-message rows must commit atomically; tx is not ACL-wrapped', db, async tx => {
                await tx.conversation.create({
                  data: {
                    conversationId: generatedConversationId,
                    channelId: channel.id,
                    createdBy: resolvedReporterId,
                    initialMessageId,
                    workspaceId,
                    createdAt,
                    lastActivityAt: createdAt,
                  },
                });

   	              await tx.message.create({
   	                data: {
   	                  messageId: initialMessageId,
   	                  conversationId: generatedConversationId,
   	                  senderId: initialTicketMessageSenderId,
   	                  workspaceId,
   	                  content: rootMessageContent,
  	                  msgType: MessageType.USER,
  	                  hasAttachment: false,
  	                  edited: false,
  	                  isDeleted: false,
  	                  showInChannel: false,
  	                  visibleTo: null,
  	                  createdAt,
  	                },
  	              });

  	              const initialMessageMd = buildInitialMessageMd({
  	                messageId: initialMessageId,
  	                conversationId: generatedConversationId,
  	                senderId: initialTicketMessageSenderId,
  	                content: rootMessageContent,
  	                msgType: MessageType.USER as InitialMessageSummary['msgType'],
  	                hasAttachment: false,
  	                edited: false,
  	                isDeleted: false,
  	                showInChannel: false,
                  visibleTo: null,
                  createdAt: createdAt.getTime(),
                  metadata: null,
                  nudgeCount: null,
                  isSent: true,
                  reactions_md: null,
                  link_preview_md: null,
                  childConversationId: null,
                });

                await tx.conversationParticipant.upsert({
                  where: {
                    conversationId_userId: {
                      conversationId: generatedConversationId,
                      userId: resolvedReporterId,
                    },
                  },
                  create: {
                    id: randomUUID(),
                    conversationId: generatedConversationId,
                    userId: resolvedReporterId,
                    participationType: ConversationParticipation.AUTHOR,
                    isSubscribed: true,
                    joinedAt: createdAt,
                    channelId: channel.id,
                    workspaceId,
                  },
                  update: {
                    participationType: ConversationParticipation.AUTHOR,
                    isSubscribed: true,
                  },
                });

                const xyneId = await generateTicketId(tx as any, project.id);

                const dueDateRaw = issue.fields.duedate;
                const eta =
                  typeof dueDateRaw === 'string' && dueDateRaw.trim()
                    ? new Date(dueDateRaw)
                    : undefined;

  	              const createdTicket = await self.ticketRepository.createTicket(
  	                {
  	                  title: summary,
  	                  description,
  	                  createdBy: resolvedReporterId,
  	                  updatedBy: fallbackUserId,
  	                  assignedTo: assignee ? resolvedAssigneeId : undefined,
  	                  conversationId: generatedConversationId,
  	                  channelId: channel.id,
  	                  projectId: project.id,
                    boardId: board.id,
                    statusV2: stageMatch.statusV2,
                    priority: mapPriority(issue.fields.priority?.name),
                    xyneId,
  	                  ticketType: mapJiraIssueTypeToTicketType(issue.fields.issuetype?.name),
  	                  stageName: stageMatch.stageName,
                      skipStageEta: true,
  	                  createdAt: createdAt.toISOString(),
  	                  workspaceId,
                    ...(eta ? { eta } : {}),
  	                },
  	                tx as any,
  	              );

                const ticketMd = serializeTicketMd({
                  id: createdTicket.id,
                  title: createdTicket.title,
                  description: createdTicket.description,
                  statusV2: createdTicket.statusV2 as TicketCardSummary['statusV2'],
                  priority: createdTicket.priority as TicketCardSummary['priority'],
                  assignedTo: createdTicket.assignedTo ?? null,
                  createdBy: createdTicket.createdBy,
                  createdAt: createdTicket.createdAt.getTime(),
                  eta: createdTicket.eta ? createdTicket.eta.getTime() : null,
                  xyneId: createdTicket.xyneId,
                  stageName: createdTicket.stageName,
                  ticketType: createdTicket.ticketType ?? null,
                  channelId: createdTicket.channelId,
                  conversationId: createdTicket.conversationId,
                });

                await tx.conversation.update({
                  where: { conversationId: generatedConversationId },
                  data: {
                    ticketId: createdTicket.id,
                    initial_message_md: initialMessageMd,
                    ticket_md: ticketMd,
                  },
                });

                await tx.externalMessage.createMany({
                  data: [
                    {
                      externalSourceId,
                      externalId: issue.id,
                      externalThreadId: self.buildIssueThreadExternalId(issue.id),
                      messageId: createdTicket.id,
                      entityId: createdTicket.id,
                      direction: MessageDirection.INCOMING,
                      entityType: ExternalEntityType.TICKET,
                      workspaceId,
                    },
                    {
                      externalSourceId,
                      externalId: self.buildIssueRootMessageExternalId(issue.id),
                      externalThreadId: self.buildIssueThreadExternalId(issue.id),
                      messageId: initialMessageId,
                      entityId: initialMessageId,
                      direction: MessageDirection.INCOMING,
                      entityType: ExternalEntityType.MESSAGE,
                      workspaceId,
                    },
                  ],
                  skipDuplicates: true,
                });

                return createdTicket;
              });
}
