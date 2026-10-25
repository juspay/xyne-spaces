import type { FieldOptionsContext, FieldOptionsPage } from '@xyne/workflow-sdk';
import { BaseActionStep, variableRef, withOptions } from '@xyne/workflow-sdk';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { BaseTicketType, FormEntityType, ReleaseTrackingMode, VCSProviderType } from '@xyne/shared';
import { z } from 'zod';
import { db } from '@/database/client';
import { FormsRepository } from '@/database/repositories/formsRepository';
import type { XyneCtx } from '@/workflowsV2/types';
import { parseBitbucketRepoUrl, parseGitHubRepoUrl } from '@/utils/repoUrlParser';
import { boardOptions, noOptions, optionsQuery } from '../../xyne-spaces/options';
import { workspaceOf } from '../../xyne-spaces/context';

const FindReleaseForBranchConfigSchema = z.object({
  boardId: withOptions(variableRef(z.string().min(1))).describe('The main release board'),
  branch: variableRef(z.string().min(1)).describe(
    'The release branch, such as the branch a pull request merged into. A release matches when its title is this branch'
  ),
  repository: variableRef(z.string())
    .optional()
    .describe(
      "owner/name or URL of the branch's repository. When given, it must be the board's repository"
    ),
});
type FindReleaseForBranchConfig = z.infer<typeof FindReleaseForBranchConfigSchema>;

const FindReleaseForBranchOutputSchema = z.object({
  found: z.boolean(),
  reason: z.string().nullable().describe('Why no release was found'),
  releaseId: z.string().nullable(),
  xyneId: z.string().nullable(),
  title: z.string().nullable(),
  conversationId: z.string().nullable().describe("The release's thread"),
  channelId: z.string().nullable(),
  branch: z.string().nullable().describe('The branch the release was cut from'),
  deployedCommitId: z.string().nullable(),
  newCommitId: z
    .string()
    .nullable()
    .describe('Where the release was cut; commits after it are hotfixes'),
  releaseNotesCanvasUrl: z.string().nullable(),
});
type FindReleaseForBranchOutput = z.infer<typeof FindReleaseForBranchOutputSchema>;

const formsRepository = new FormsRepository();

export class FindReleaseForBranchStep extends BaseActionStep<
  typeof FindReleaseForBranchConfigSchema,
  FindReleaseForBranchOutput
> {
  readonly type = 'FIND_RELEASE_FOR_BRANCH';
  readonly configSchema = FindReleaseForBranchConfigSchema;
  readonly outputSchema = FindReleaseForBranchOutputSchema;
  readonly name = 'Find release for branch';
  readonly description =
    'Finds the newest active release on a release board whose title is the branch, with its commit range.';
  readonly category = 'release';
  readonly icon = 'GitBranch';

  override getOptions(
    ctx: FieldOptionsContext<FindReleaseForBranchConfig, Record<string, unknown>, XyneCtx>
  ): Promise<FieldOptionsPage> {
    return ctx.field === 'boardId' ? boardOptions(optionsQuery(ctx)) : Promise.resolve(noOptions);
  }

  async execute(
    config: FindReleaseForBranchConfig,
    ctx: StepExecutionContext
  ): Promise<FindReleaseForBranchOutput> {
    const workspaceId = workspaceOf(ctx, this.type);
    const boardId = (config.boardId as string).trim();
    const branch = (config.branch as string).trim();
    const repository = ((config.repository as string | undefined) ?? '').trim();

    const notFound = (reason: string): FindReleaseForBranchOutput => ({
      found: false,
      reason,
      releaseId: null,
      xyneId: null,
      title: null,
      conversationId: null,
      channelId: null,
      branch: null,
      deployedCommitId: null,
      newCommitId: null,
      releaseNotesCanvasUrl: null,
    });

    const board = await db.board.findFirst({
      where: { id: boardId, workspaceId },
      select: {
        id: true,
        name: true,
        vcsProvider: true,
        releaseTrackingMode: true,
        mainReleaseApplications: {
          select: { repo: { select: { url: true, canonicalUrl: true } } },
        },
      },
    });
    if (!board) throw new Error(`Board ${boardId} not found`);
    if (board.mainReleaseApplications.length === 0) {
      throw new Error(`Board ${board.name} has no services, so it is not a main release board`);
    }
    if (board.releaseTrackingMode !== ReleaseTrackingMode.COMMIT_RANGE) {
      throw new Error(`Board ${board.name} does not track releases by commit range`);
    }

    if (repository) {
      // owner/name for GitHub, projectKey/slug for Bitbucket, compared without case like the VCS does.
      const identity = (value: string): string | null => {
        const trimmed = value.trim().replace(/\/+$/, '');
        if (!/[:@]/.test(trimmed)) return trimmed.replace(/\.git$/, '').toLowerCase();
        if (board.vcsProvider === VCSProviderType.BITBUCKET_SERVER) {
          const parsed = parseBitbucketRepoUrl(trimmed);
          return parsed ? `${parsed.projectKey}/${parsed.repoSlug}`.toLowerCase() : null;
        }
        const parsed = parseGitHubRepoUrl(trimmed);
        return parsed ? `${parsed.owner}/${parsed.repo}`.toLowerCase() : null;
      };
      const boardRepos = new Set(
        board.mainReleaseApplications
          .map((service) => service.repo?.canonicalUrl || service.repo?.url || '')
          .filter(Boolean)
          .map(identity)
      );
      if (!boardRepos.has(identity(repository))) {
        return notFound(`${repository} is not the repository of board ${board.name}`);
      }
    }

    // A multi-repo release lives on its primary board and reaches this board through release_repositories.
    const repoRows = await db.releaseRepository.findMany({
      where: { mainReleaseBoardId: board.id },
      select: { releaseId: true, branch: true, deployedCommit: true, newCommit: true },
    });
    const repoRowByRelease = new Map(repoRows.map((row) => [row.releaseId, row]));

    const candidates = await db.ticket.findMany({
      where: {
        workspaceId,
        isArchived: false,
        ticketType: { in: [BaseTicketType.Release, BaseTicketType.Hotfix] },
        title: { contains: branch },
        OR: [{ boardId: board.id }, { id: { in: [...repoRowByRelease.keys()] } }],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        xyneId: true,
        title: true,
        conversationId: true,
        channelId: true,
        metadata: true,
      },
    });

    // Newest first; one without a commit range yet hands over to the next older.
    for (const release of candidates.filter((candidate) => candidate.title.trim() === branch)) {
      const row = repoRowByRelease.get(release.id);
      const formValues = row
        ? null
        : await formsRepository.getFormEntityValuesByEntityId(release.id, FormEntityType.TICKET);
      const cutFrom = (row?.branch ?? String(formValues?.['branch'] ?? '')).trim();
      const deployedCommitId = (
        row?.deployedCommit ?? String(formValues?.['deployedCommitId'] ?? '')
      ).trim();
      const newCommitId = (row?.newCommit ?? String(formValues?.['newCommitId'] ?? '')).trim();
      if (!deployedCommitId || !newCommitId) continue;

      const canvasUrl = (release.metadata as Record<string, unknown> | null)?.[
        'releaseNotesCanvasUrl'
      ];
      return {
        found: true,
        reason: null,
        releaseId: release.id,
        xyneId: release.xyneId,
        title: release.title,
        conversationId: release.conversationId,
        channelId: release.channelId,
        branch: cutFrom || null,
        deployedCommitId,
        newCommitId,
        releaseNotesCanvasUrl: typeof canvasUrl === 'string' && canvasUrl ? canvasUrl : null,
      };
    }

    return notFound(
      `No active release on board ${board.name} is named ${branch} and has a commit range`
    );
  }
}
