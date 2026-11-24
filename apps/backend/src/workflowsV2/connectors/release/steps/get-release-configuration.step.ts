import type { FieldOptionsContext, FieldOptionsPage } from '@xyne/workflow-sdk';
import { BaseActionStep, variableRef, withOptions } from '@xyne/workflow-sdk';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { z } from 'zod/v3';
import { db } from '@/database/client';
import type { XyneCtx } from '@/workflowsV2/types';
import { boardOptions, noOptions, optionsQuery } from '../../xyne-spaces/options';
import { workspaceOf } from '../../xyne-spaces/context';
import { boardIssues } from '../../xyne-spaces/validation';
import type { Checked, ConfigIssue } from '../../xyne-spaces/validation';

const GetReleaseConfigurationConfigSchema = z.object({
  boardId: withOptions(variableRef(z.string().min(1))).describe('The main release board'),
});

const ReleaseServiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  boardId: z.string().describe("The service's own board, where its release tickets go"),
  regex: z.string().describe('Matches the file paths that belong to the service'),
  envPaths: z.array(z.string()).describe('Environment file paths, matched against changed files'),
  migrationPaths: z.array(z.string()).describe('Migration file paths, matched against changed files'),
});

const GetReleaseConfigurationOutputSchema = z.object({
  trackingMode: z.string().nullable().describe('COMMIT_RANGE or VERSION'),
  vcsProvider: z.string().nullable().describe('GITHUB or BITBUCKET_SERVER'),
  repoUrl: z.string(),
  ticketPrefix: z.string().describe("Prefix of the ticket IDs in pull request titles: the board's project code"),
  services: z.array(ReleaseServiceSchema),
});

type GetReleaseConfigurationOutput = z.infer<typeof GetReleaseConfigurationOutputSchema>;

export class GetReleaseConfigurationStep extends BaseActionStep<
  typeof GetReleaseConfigurationConfigSchema,
  GetReleaseConfigurationOutput
> {
  readonly type = 'GET_RELEASE_CONFIGURATION';
  readonly configSchema = GetReleaseConfigurationConfigSchema;
  readonly outputSchema = GetReleaseConfigurationOutputSchema;
  readonly name = 'Get release configuration';
  readonly description =
    "Gets a release board's configuration: tracking mode, repository, and services with their regex, env and migration paths.";
  readonly category = 'release';
  readonly icon = 'Rocket';

  override getOptions(
    ctx: FieldOptionsContext<z.infer<typeof GetReleaseConfigurationConfigSchema>, Record<string, unknown>, XyneCtx>,
  ): Promise<FieldOptionsPage> {
    return ctx.field === 'boardId' ? boardOptions(optionsQuery(ctx)) : Promise.resolve(noOptions);
  }

  validateConfig(ctx: Checked<{ boardId?: string }>): Promise<ConfigIssue[]> {
    return boardIssues(ctx, 'boardId', ctx.known.boardId);
  }

  async execute(
    config: z.infer<typeof GetReleaseConfigurationConfigSchema>,
    ctx: StepExecutionContext,
  ): Promise<GetReleaseConfigurationOutput> {
    const boardId = (config.boardId as string).trim();
    const board = await db.board.findFirst({
      where: { id: boardId, workspaceId: workspaceOf(ctx, this.type) },
      select: {
        name: true,
        vcsProvider: true,
        releaseTrackingMode: true,
        project: { select: { code: true } },
        mainReleaseApplications: {
          select: {
            id: true,
            name: true,
            boardId: true,
            regex: true,
            repo: { select: { url: true, canonicalUrl: true } },
            envPaths: true,
            migrationPaths: true,
          },
          orderBy: { name: 'asc' },
        },
      },
    });
    if (!board) throw new Error(`Board ${boardId} not found`);

    const services = board.mainReleaseApplications;
    if (services.length === 0) {
      throw new Error(`Board ${board.name} has no services, so it is not a main release board`);
    }
    const repoUrls = [
      ...new Set(
        services.map((service) =>
          (service.repo?.canonicalUrl || service.repo?.url || '').trim().replace(/\/+$/, ''),
        ),
      ),
    ];
    const repoUrl = repoUrls[0];
    if (repoUrls.length !== 1 || !repoUrl) {
      throw new Error(`Services on board ${board.name} do not share one repository URL: ${repoUrls.join(', ')}`);
    }

    return {
      trackingMode: board.releaseTrackingMode,
      vcsProvider: board.vcsProvider,
      repoUrl,
      ticketPrefix: board.project.code,
      services: services.map(({ id, name, boardId, regex, envPaths, migrationPaths }) => ({
        id,
        name,
        boardId,
        regex,
        envPaths,
        migrationPaths,
      })),
    };
  }
}
