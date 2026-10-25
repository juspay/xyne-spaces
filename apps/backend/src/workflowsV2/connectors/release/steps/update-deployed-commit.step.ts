import { BaseActionStep, variableRef } from '@xyne/workflow-sdk';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { BaseTicketType } from '@xyne/shared';
import { z } from 'zod';
import { db } from '@/database/client';
import { workspaceOf } from '../../xyne-spaces/context';

const UpdateDeployedCommitConfigSchema = z.object({
  releaseTicket: variableRef(z.string().min(1)).describe('Release ticket id or ID like PLAT-12'),
  commitId: variableRef(z.string().min(1)).describe('The commit the release deploys'),
  services: variableRef(z.array(z.string().min(1))).describe("Names or ids of the release's affected services"),
  allowSameRelease: z
    .boolean()
    .optional()
    .describe('Move it again when this release already set it, as a hotfix does. A newer release still wins'),
});
type UpdateDeployedCommitConfig = z.infer<typeof UpdateDeployedCommitConfigSchema>;

const UpdateDeployedCommitOutputSchema = z.object({
  updated: z.array(z.string()),
  skipped: z.array(z.string()).describe('Already set by this release or a newer one; with allowSameRelease, by a newer one'),
  notFound: z.array(z.string()).describe("Names or ids that are not services of the release's board"),
});
type UpdateDeployedCommitOutput = z.infer<typeof UpdateDeployedCommitOutputSchema>;

export class UpdateDeployedCommitStep extends BaseActionStep<
  typeof UpdateDeployedCommitConfigSchema,
  UpdateDeployedCommitOutput
> {
  readonly type = 'UPDATE_DEPLOYED_COMMIT';
  readonly configSchema = UpdateDeployedCommitConfigSchema;
  readonly outputSchema = UpdateDeployedCommitOutputSchema;
  readonly name = 'Update deployed commit';
  readonly description =
    "Sets the release's commit as the deployed commit of its affected services, unless this release or a newer one already did. Hotfixes can let the same release move it again.";
  readonly category = 'release';
  readonly icon = 'GitCommit';

  async execute(config: UpdateDeployedCommitConfig, ctx: StepExecutionContext): Promise<UpdateDeployedCommitOutput> {
    const identifier = (config.releaseTicket as string).trim();
    const commitId = (config.commitId as string).trim();
    const raw = Array.isArray(config.services) ? config.services : String(config.services ?? '').split(',');
    const requested = [...new Set(raw.map((service) => service.trim()).filter(Boolean))];

    const release = await db.ticket.findFirst({
      where: { workspaceId: workspaceOf(ctx, this.type), OR: [{ id: identifier }, { xyneId: identifier }] },
      select: { id: true, boardId: true, workspaceId: true, createdAt: true },
    });
    if (!release) throw new Error(`Release ticket ${identifier} not found`);

    const services = await db.application.findMany({
      where: {
        mainReleaseBoardId: release.boardId,
        OR: [{ id: { in: requested } }, { name: { in: requested } }],
      },
      select: { id: true, name: true, lastDeployedAt: true },
    });
    const notFound = requested.filter((key) => !services.some((service) => service.id === key || service.name === key));
    // A service set at or after `since` was set by this release or a newer one. With allowSameRelease only a
    // newer release counts, and with none on the board every service is moved.
    const newerRelease = config.allowSameRelease
      ? await db.ticket.findFirst({
          where: {
            boardId: release.boardId,
            workspaceId: release.workspaceId,
            ticketType: { in: [BaseTicketType.Release, BaseTicketType.Hotfix] },
            createdAt: { gt: release.createdAt },
          },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        })
      : null;
    const since = config.allowSameRelease ? (newerRelease?.createdAt ?? null) : release.createdAt;
    const notYetSet = since ? { OR: [{ lastDeployedAt: null }, { lastDeployedAt: { lt: since } }] } : {};
    const eligible = services.filter((service) => !since || !service.lastDeployedAt || service.lastDeployedAt < since);

    await db.application.updateMany({
      where: { id: { in: eligible.map((service) => service.id) }, ...notYetSet },
      data: { deployedCommit: commitId, lastDeployedAt: new Date() },
    });

    return {
      updated: eligible.map((service) => service.name),
      skipped: services.filter((service) => !eligible.includes(service)).map((service) => service.name),
      notFound,
    };
  }
}
