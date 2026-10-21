import { transaction } from '../base';
import { ApplicationRepository, CreateApplicationSubTicketsOpts, prisma } from '@/database/repositories/applicationRepository';
import { TicketPriority, ActivityType } from '@xyne/shared';
import { dualWriteTicketTag } from '@/services/ticketTagDualWriteService';
import { generateTicketId } from '@/bypassAcl/transactions/ticketIdService';
import { advisoryXactLock } from '@/bypassAcl/lockServices';


export function createApplicationSubTicketsTx(opts: CreateApplicationSubTicketsOpts, self: ApplicationRepository) {
  return transaction([], 'createApplicationSubTickets: advisory-lock acquisition and delegated locked subticket creation must run in one transaction; tx is not ACL-wrapped', prisma, 
    async (tx) => {
      await advisoryXactLock(tx, ['Ticket'],
        'release sub-tickets: serialize sub-ticket creation for one parent ticket',
        'release-subtickets:' + opts.parentTicketId);
      return self.createApplicationSubTicketsLocked(opts);
    },
    { maxWait: 10_000, timeout: 60_000 },
  );
}
export function createApplicationSubTicketsLockedTx(projectId: string, prLinksByApplication: Map<string, string[]>, application: any, parentTitle: string, createdBy: string, conversationId: string, channelId: string, ticketWorkspaceId: string, isHotFix: boolean | undefined, parentTicketId: string) {
  return transaction(['Project', 'ProjectTag', 'Stage', 'SubTicket', 'Ticket', 'TicketActivity', 'TicketSubTicketMapping', 'TicketTag', 'TicketTagMapping'], 'createApplicationSubTicketsLocked: per-application ticket, sub-ticket, mapping, activity and tag writes plus id allocation must commit atomically; tx is not ACL-wrapped', prisma, async (tx) => {
    const xyneId = await generateTicketId(tx, projectId);

    const prLinks = prLinksByApplication.get(application.id) || [];
    const prLinksSection = prLinks.length > 0
      ? `\n\nPull Requests:\n${prLinks.map(link => `- ${link}`).join('\n')}`
      : '';

    // Pick the application's release board's first stage (lowest
    // sequenceNumber) so the per-app ticket lands on the board's
    // configured first column instead of a hardcoded 'Release' label
    // that may not exist on the board.
    const firstStage = await tx.stage.findFirst({
      where: { boardId: application.boardId! },
      orderBy: { sequenceNumber: 'asc' },
      select: { name: true, defaultTicketStatusV2: true },
    });

    const ticket = await tx.ticket.create({
      data: {
        title: `${parentTitle} - ${application.name}`,
        description: `Release ticket for ${application.name} application.${prLinksSection}`,
        createdBy,
        updatedBy: createdBy,
        conversationId,
        channelId,
        xyneId,
        projectId,
        workspaceId: ticketWorkspaceId,
        boardId: application.boardId,
        statusV2: firstStage?.defaultTicketStatusV2 ?? 'TODO',
        priority: TicketPriority.LOW,
        stageName: firstStage?.name ?? 'Backlog',
        lastEmailAt: new Date(),
      },
    });

    if (isHotFix) {
      await tx.ticketTag.create({
        data: {
          ticketId: ticket.id,
          name: 'HotFix',
          workspaceId: ticketWorkspaceId,
        }
      })
      await dualWriteTicketTag(ticket.id, 'HotFix', tx);
    }

    const subTicket = await tx.subTicket.create({
      data: {
        title: `${parentTitle} - ${application.name}`,
        description: `Release sub-ticket for ${application.name} application.${prLinksSection}`,
        createdBy,
        updatedBy: createdBy,
        conversationId,
        mappedTicketId: ticket.id,
        assignedTo: null,
        workspaceId: ticketWorkspaceId,
      },
    });

    await tx.ticketSubTicketMapping.create({
      data: { ticketId: parentTicketId, subTicketId: subTicket.id, workspaceId: ticketWorkspaceId },
    });

    await tx.ticketActivity.create({
      data: {
        ticketId: parentTicketId,
        workspaceId: ticketWorkspaceId,
        updatedBy: createdBy,
        activityType: ActivityType.SUBTICKET_CREATED,
        value: {
          subTicketId: subTicket.id,
          subTicketTitle: subTicket.title,
          applicationName: application.name,
          applicationId: application.id,
          ticketId: ticket.id,
          ticketXyneId: xyneId,
        },
      },
    });

    return { subTicketId: subTicket.id, mappedTicketId: ticket.id, xyneId };
  });
}
