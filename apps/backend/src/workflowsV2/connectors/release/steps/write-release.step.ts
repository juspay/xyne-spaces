import { BaseActionStep, variableRef } from '@xyne/workflow-sdk';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { z } from 'zod/v3';
import { db } from '@/database/client';
import { workspaceOf } from '../../xyne-spaces/context';
import { ticketIssues } from '../../xyne-spaces/validation';
import type { Checked, ConfigIssue } from '../../xyne-spaces/validation';
import type { AnalysedService } from './analyse-release.step';
import { AddTicketsUnderReleaseStep } from './add-tickets-under-release.step';
import { AddChangeUnderReleaseStep } from './add-change-under-release.step';

const WriteReleaseConfigSchema = z.object({
  releaseTicket: variableRef(z.string().min(1)).describe('Ticket id or ID like PLAT-12 of the release'),
  services: variableRef(z.array(z.unknown())).describe('The affected services from the release analysis'),
});
type WriteReleaseConfig = z.infer<typeof WriteReleaseConfigSchema>;

const WriteReleaseOutputSchema = z.object({
  ticketsAdded: z.number().describe('Dev tickets newly added under the service tickets'),
  changesAdded: z.number().describe('Env and migration changes newly saved'),
});
type WriteReleaseOutput = z.infer<typeof WriteReleaseOutputSchema>;

const addTickets = new AddTicketsUnderReleaseStep();
const addChange = new AddChangeUnderReleaseStep();

export class WriteReleaseStep extends BaseActionStep<typeof WriteReleaseConfigSchema, WriteReleaseOutput> {
  readonly type = 'WRITE_RELEASE';
  readonly configSchema = WriteReleaseConfigSchema;
  readonly outputSchema = WriteReleaseOutputSchema;
  readonly name = 'Write release';
  readonly description =
    "Adds the analysed dev tickets and env and migration changes under each service's ticket of the release. Fails, after trying everything, when any of them could not be added.";
  readonly category = 'release';
  readonly icon = 'ListPlus';

  validateConfig(ctx: Checked<{ releaseTicket?: string }>): Promise<ConfigIssue[]> {
    return ticketIssues(ctx, 'releaseTicket', ctx.known.releaseTicket);
  }

  async execute(config: WriteReleaseConfig, ctx: StepExecutionContext): Promise<WriteReleaseOutput> {
    const identifier = (config.releaseTicket as string).trim();
    const services = config.services as AnalysedService[];

    const release = await db.ticket.findFirst({
      where: { workspaceId: workspaceOf(ctx, this.type), OR: [{ id: identifier }, { xyneId: identifier }] },
      select: { id: true },
    });
    if (!release) throw new Error(`Release ticket ${identifier} not found`);

    // The service ticket of each service: the release's sub-ticket on the service's board.
    const mappings = await db.ticketSubTicketMapping.findMany({
      where: { ticketId: release.id },
      select: { subTicket: { select: { mappedTicket: { select: { id: true, boardId: true } } } } },
    });
    const ticketOfBoard = new Map(
      mappings.flatMap(({ subTicket }) => (subTicket.mappedTicket ? [[subTicket.mappedTicket.boardId, subTicket.mappedTicket.id] as const] : [])),
    );
    const missing = services.filter((s) => !ticketOfBoard.has(s.boardId)).map((s) => s.name);
    if (missing.length > 0) throw new Error(`No service ticket under the release for: ${missing.join(', ')}`);

    const failures: string[] = [];
    let ticketsAdded = 0;
    let changesAdded = 0;
    const attempt = async (what: string, run: () => Promise<void>): Promise<void> => {
      try {
        await run();
      } catch (error) {
        failures.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    for (const service of services) {
      const ticket = ticketOfBoard.get(service.boardId) as string;
      if (service.ticketIds.length > 0) {
        await attempt(`${service.name} tickets`, async () => {
          ticketsAdded += (await addTickets.execute({ ticket, xyneIds: service.ticketIds }, ctx)).added.length;
        });
      }
      const changes = [
        ...service.envChanges.map((c) => ({ kind: 'ENV' as const, ...c })),
        ...service.migrationChanges.map((c) => ({ kind: 'MIGRATION' as const, ...c })),
      ];
      for (const c of changes) {
        await attempt(`${service.name} ${c.kind} ${c.filePath}`, async () => {
          const out = await addChange.execute(
            {
              ticket,
              kind: c.kind,
              filePath: c.filePath,
              diff: c.diff,
              commitId: c.commitId,
              sourceXyneId: c.ticketId ?? undefined,
              fileStatus: c.status,
            },
            ctx,
          );
          if (out.created) changesAdded += 1;
        });
      }
    }
    if (failures.length > 0) throw new Error(`Release not fully written: ${failures.join('; ')}`);
    return { ticketsAdded, changesAdded };
  }
}
