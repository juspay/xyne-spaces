import { BaseActionStep, variableRef } from '@xyne/workflow-sdk';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { BaseTicketType } from '@xyne/shared';
import { z } from 'zod';
import { db } from '@/database/client';
import { ApplicationRepository } from '@/database/repositories/applicationRepository';
import { workspaceOf } from '../../xyne-spaces/context';

const AddTicketsUnderReleaseConfigSchema = z.object({
  ticket: variableRef(z.string().min(1)).describe("Ticket id or ID like PLAT-12 of the release's service ticket"),
  xyneIds: variableRef(z.array(z.string().min(1))).describe('IDs like PLAT-12 of the tickets to add'),
  isHotfix: z
    .boolean()
    .optional()
    .describe('Mark the tickets as hotfixes on the release, also ones already under it. Off: only a Hotfix release marks them'),
});
type AddTicketsUnderReleaseConfig = z.infer<typeof AddTicketsUnderReleaseConfigSchema>;

const AddTicketsUnderReleaseOutputSchema = z.object({
  added: z.array(z.string()),
  alreadyLinked: z.array(z.string()),
  markedHotfix: z.array(z.string()).describe('Tickets already under the release that are now marked as hotfixes'),
  notFound: z.array(z.string()).describe('IDs with no ticket in this workspace'),
});
type AddTicketsUnderReleaseOutput = z.infer<typeof AddTicketsUnderReleaseOutputSchema>;

const applicationRepository = new ApplicationRepository();

export class AddTicketsUnderReleaseStep extends BaseActionStep<
  typeof AddTicketsUnderReleaseConfigSchema,
  AddTicketsUnderReleaseOutput
> {
  readonly type = 'ADD_TICKETS_UNDER_RELEASE';
  readonly configSchema = AddTicketsUnderReleaseConfigSchema;
  readonly outputSchema = AddTicketsUnderReleaseOutputSchema;
  readonly name = 'Add tickets under release';
  readonly description =
    "Adds dev tickets, by ID, to a release under one of its service tickets. Tickets already there are skipped, or only marked as hotfixes.";
  readonly category = 'release';
  readonly icon = 'ListPlus';

  async execute(config: AddTicketsUnderReleaseConfig, ctx: StepExecutionContext): Promise<AddTicketsUnderReleaseOutput> {
    const workspaceId = workspaceOf(ctx, this.type);
    const identifier = (config.ticket as string).trim();
    const rawIds = Array.isArray(config.xyneIds) ? config.xyneIds : String(config.xyneIds ?? '').split(',');
    const xyneIds = [...new Set(rawIds.map((id) => id.trim()).filter(Boolean))];

    const target = await db.ticket.findFirst({
      where: { workspaceId, OR: [{ id: identifier }, { xyneId: identifier }] },
      select: { id: true, xyneId: true, boardId: true },
    });
    if (!target) throw new Error(`Ticket ${identifier} not found`);

    const tickets = await db.ticket.findMany({
      where: { workspaceId, xyneId: { in: xyneIds } },
      select: { id: true, xyneId: true },
    });
    const foundXyneIds = new Set(tickets.map((ticket) => ticket.xyneId));
    const notFound = xyneIds.filter((id) => !foundXyneIds.has(id));

    // A release's service ticket sits on a service board, as a sub-ticket of a ticket on that
    // service's main release board. Its dev tickets live in application_release_tickets.
    const parents = await db.ticketSubTicketMapping.findMany({
      where: { subTicket: { mappedTicketId: target.id } },
      select: { subTicketId: true, ticket: { select: { id: true, boardId: true, ticketType: true } } },
    });
    const service = await db.application.findFirst({
      where: { boardId: target.boardId, mainReleaseBoardId: { in: parents.map((parent) => parent.ticket.boardId) } },
      select: { mainReleaseBoardId: true },
    });
    const release = service ? parents.find((parent) => parent.ticket.boardId === service.mainReleaseBoardId) : undefined;

    if (!release) {
      throw new Error(`Ticket ${target.xyneId} is not a service ticket of a release`);
    }

    const existing = await db.applicationReleaseTicket.findMany({
      where: { applicationReleaseId: release.subTicketId, ticketId: { in: tickets.map((ticket) => ticket.id) } },
      select: { ticketId: true, isHotfix: true },
    });
    const linkedIds = new Set(existing.map((row) => row.ticketId));
    const toAdd = tickets.filter((ticket) => !linkedIds.has(ticket.id));
    const unmarkedIds = new Set(config.isHotfix ? existing.filter((row) => !row.isHotfix).map((row) => row.ticketId) : []);
    // The repository skips rows that exist and flips them to hotfix, so linked tickets go along when marking.
    await applicationRepository.createApplicationReleaseTicketMappings(
      (config.isHotfix ? tickets : toAdd).map((ticket) => ({
        applicationReleaseId: release.subTicketId,
        releaseId: release.ticket.id,
        devTicketId: ticket.id,
        isHotfix: config.isHotfix === true || release.ticket.ticketType === BaseTicketType.Hotfix,
      })),
    );
    return {
      added: toAdd.map((ticket) => ticket.xyneId),
      alreadyLinked: tickets.filter((ticket) => linkedIds.has(ticket.id)).map((ticket) => ticket.xyneId),
      markedHotfix: tickets.filter((ticket) => unmarkedIds.has(ticket.id)).map((ticket) => ticket.xyneId),
      notFound,
    };
  }
}
