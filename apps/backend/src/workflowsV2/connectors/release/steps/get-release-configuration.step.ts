import type { FieldOptionsContext, FieldOptionsPage } from '@xyne/workflow-sdk';
import { BaseActionStep, variableRef, withOptions } from '@xyne/workflow-sdk';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { VCSProviderType } from '@xyne/shared';
// @xyne/workflow-sdk builds its schemas with zod/v3 from the repo's zod; use that same copy.
import { z } from 'zod/v3';
import { db } from '@/database/client';
import type { XyneCtx } from '@/workflowsV2/types';
import { parseBitbucketRepoUrl, parseGitHubRepoUrl } from '@/utils/repoUrlParser';
import { boardOptions, noOptions, optionsQuery } from '../../xyne-spaces/options';
import { workspaceOf } from '../../xyne-spaces/context';

const GetReleaseConfigurationConfigSchema = z.object({
  boardId: withOptions(variableRef(z.string().min(1))).describe('The main release board'),
});

const GetReleaseConfigurationOutputSchema = z.object({
  trackingMode: z.string().nullable().describe('COMMIT_RANGE or VERSION'),
  vcsProvider: z.string().nullable().describe('GITHUB or BITBUCKET_SERVER'),
  ticketPrefix: z.string().describe("Prefix of the ticket IDs in pull request titles: the board's project code"),
  owner: z.string().nullable().describe('GitHub owner, or Bitbucket project key'),
  repo: z.string().nullable().describe('GitHub repository, or Bitbucket repository slug'),
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
    "Gets a release board's configuration: tracking mode, repository and ticket prefix.";
  readonly category = 'release';
  readonly icon = 'Rocket';

  override getOptions(
    ctx: FieldOptionsContext<z.infer<typeof GetReleaseConfigurationConfigSchema>, Record<string, unknown>, XyneCtx>,
  ): Promise<FieldOptionsPage> {
    return ctx.field === 'boardId' ? boardOptions(optionsQuery(ctx)) : Promise.resolve(noOptions);
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
          select: { repo: { select: { url: true, canonicalUrl: true } } },
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

    const github = board.vcsProvider === VCSProviderType.GITHUB ? parseGitHubRepoUrl(repoUrl) : null;
    const bitbucket = board.vcsProvider === VCSProviderType.BITBUCKET_SERVER ? parseBitbucketRepoUrl(repoUrl) : null;

    return {
      trackingMode: board.releaseTrackingMode,
      vcsProvider: board.vcsProvider,
      ticketPrefix: board.project.code,
      owner: github?.owner ?? bitbucket?.projectKey ?? null,
      repo: github?.repo ?? bitbucket?.repoSlug ?? null,
    };
  }
}
