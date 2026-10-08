import { BaseActionStep, variableRef } from '@xyne/workflow-sdk';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { z } from 'zod';
import { db } from '@/database/client';
import { workspaceOf } from '../context';

const UpdateDeployedCommitConfigSchema = z.object({
  releaseTicket: variableRef(z.string().min(1)).describe('Release ticket id or ID like PLAT-12'),
  commitId: variableRef(z.string().min(1)).describe('The commit the release deploys'),
  services: variableRef(z.array(z.string().min(1))).describe("Names or ids of the release's affected services"),
});
type UpdateDeployedCommitConfig = z.infer<typeof UpdateDeployedCommitConfigSchema>;

const UpdateDeployedCommitOutputSchema = z.object({
  updated: z.array(z.string()),
  skipped: z.array(z.string()).describe('Already set by this release or a newer one'),
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
    "Sets the release's commit as the deployed commit of its affected services, unless this release or a newer one already did.";
  readonly category = 'release';
  readonly icon = 'GitCommit';

  async execute(config: UpdateDeployedCommitConfig, ctx: StepExecutionContext): Promise<UpdateDeployedCommitOutput> {
    const identifier = (config.releaseTicket as string).trim();
    const commitId = (config.commitId as string).trim();
    const raw = Array.isArray(config.services) ? config.services : String(config.services ?? '').split(',');
    const requested = [...new Set(raw.map((service) => service.trim()).filter(Boolean))];

    const release = await db.ticket.findFirst({
      where: { workspaceId: workspaceOf(ctx, this.type), OR: [{ id: identifier }, { xyneId: identifier }] },
      select: { id: true, boardId: true, createdAt: true },
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
    const notYetSet = { OR: [{ lastDeployedAt: null }, { lastDeployedAt: { lt: release.createdAt } }] };
    const eligible = services.filter((service) => !service.lastDeployedAt || service.lastDeployedAt < release.createdAt);

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
