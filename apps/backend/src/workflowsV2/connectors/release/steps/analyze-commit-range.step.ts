import { BaseActionStep, variableRef } from '@xyne/workflow-sdk';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { BaseTicketType, FormEntityType, ReleaseEventType, VCSProviderType } from '@xyne/shared';
// @xyne/workflow-sdk builds its schemas with zod/v3 from the repo's zod; use that same copy.
import { z } from 'zod/v3';
import { db } from '@/database/client';
import { FormsRepository } from '@/database/repositories/formsRepository';
import { ApplicationRepository } from '@/database/repositories/applicationRepository';
import { ReleaseRepository } from '@/database/repositories/releaseRepository';
import { postLoadingMessage } from '@/controllers/commitAnalysisController';
import { conversationService } from '@/services/conversationService';
import { escapeHtml } from '@/utils/htmlEscape';
import { CommitAnalysisService } from '@/services/commitAnalysisService';
import { buildVcsClient } from '@/services/release/buildVcsClient';
import { ChangeDetector, buildPRLinksByApplication, filterResultsByApplication } from '@/services/release/core';
import { unifiedBotUserService } from '@/bots/unified';
import { workspaceOf } from '../../xyne-spaces/context';

const AnalyzeCommitRangeConfigSchema = z.object({
  vcsProvider: variableRef(z.string()).describe('GITHUB or BITBUCKET_SERVER, from Get release configuration'),
  owner: variableRef(z.string().min(1)).describe('GitHub owner, or Bitbucket project key'),
  repo: variableRef(z.string().min(1)).describe('GitHub repository, or Bitbucket repository slug'),
  ticketPrefix: variableRef(z.string().min(1)).describe('Prefix of the ticket IDs in pull request titles'),
  releaseTicket: variableRef(z.string().min(1)).describe('Release ticket id or ID like PLAT-12; its commit range is analyzed'),
  boardId: variableRef(z.string().min(1)).describe('The main release board the release is on'),
});
type AnalyzeCommitRangeConfig = z.infer<typeof AnalyzeCommitRangeConfigSchema>;

const AnalyzeCommitRangeOutputSchema = z.object({
  vcsProvider: z.string(),
  owner: z.string(),
  repo: z.string(),
  deployedCommitId: z.string(),
  newCommitId: z.string().describe('The commit the release deploys'),
  results: z.array(z.any()).describe('Per-commit analysis: pull request, dev ticket, files'),
  appMatchSummary: z.array(z.any()).describe('Per configured service: how many changed files its regex matched'),
  services: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      xyneId: z.string().describe("ID like PLAT-12 of the service's release ticket"),
      subTicketId: z.string(),
      mappedTicketId: z.string(),
      xyneIds: z.array(z.string()).describe('IDs like PLAT-12 of the dev tickets whose pull requests touch the service'),
      matchedFiles: z.array(z.string()),
      changes: z.array(
        z.object({
          serviceXyneId: z.string().describe('The service ticket the change belongs to'),
          kind: z.enum(['ENV', 'MIGRATION']),
          filePath: z.string(),
          diff: z.string(),
          commitId: z.string(),
          sourceXyneId: z.string().nullable(),
          fileStatus: z.string(),
        }),
      ),
    }),
  ).describe('Only the services the range touches'),
});
type AnalyzeCommitRangeOutput = z.infer<typeof AnalyzeCommitRangeOutputSchema>;

const formsRepository = new FormsRepository();
const releaseRepository = new ReleaseRepository();
const applicationRepository = new ApplicationRepository();

export class AnalyzeCommitRangeStep extends BaseActionStep<typeof AnalyzeCommitRangeConfigSchema, AnalyzeCommitRangeOutput> {
  readonly type = 'ANALYZE_COMMIT_RANGE';
  readonly configSchema = AnalyzeCommitRangeConfigSchema;
  readonly outputSchema = AnalyzeCommitRangeOutputSchema;
  readonly name = 'Analyze commit range';
  readonly description =
    "Shows the release's \"Analyzing commits...\" card, then reads the commits of its range from GitHub or Bitbucket. Per service it returns the dev tickets (from pull request titles) and the env and migration changes.";
  readonly category = 'release';
  readonly icon = 'GitCompare';

  async execute(config: AnalyzeCommitRangeConfig, ctx: StepExecutionContext): Promise<AnalyzeCommitRangeOutput> {
    const workspaceId = workspaceOf(ctx, this.type);
    const identifier = (config.releaseTicket as string).trim();
    const boardId = config.boardId as string;
    const release = await db.ticket.findFirst({
      where: { workspaceId, OR: [{ id: identifier }, { xyneId: identifier }] },
      select: { id: true, title: true, projectId: true, ticketType: true, createdBy: true, conversationId: true, channelId: true },
    });
    if (!release) throw new Error(`Release ticket ${identifier} not found`);
    // A multi-repo release keeps its range per board in release_repositories, otherwise in the ticket's form values.
    // The ticket-created event fires a moment before the controller saves the ranges, so give them a few seconds.
    let branch: string | undefined;
    let deployedCommitId = '';
    let newCommitId = '';
    for (let attempt = 0; attempt < 5 && !(deployedCommitId && newCommitId); attempt++) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, 1000));
      const rows = await db.releaseRepository.findMany({
        where: { releaseId: release.id },
        select: { branch: true, deployedCommit: true, newCommit: true },
      });
      if (rows.length > 1) throw new Error(`Release ${identifier} spans more than one repository; this workflow analyzes one`);
      const row = rows[0];
      const form = row ? null : await formsRepository.getFormEntityValuesByEntityId(release.id, FormEntityType.TICKET);
      branch = (row?.branch ?? String(form?.['branch'] ?? '')).trim() || undefined;
      deployedCommitId = (row?.deployedCommit ?? String(form?.['deployedCommitId'] ?? '')).trim();
      newCommitId = (row?.newCommit ?? String(form?.['newCommitId'] ?? '')).trim();
    }
    if (!deployedCommitId || !newCommitId) throw new Error(`Release ${identifier} has no commit range`);

    const owner = config.owner as string;
    const repo = config.repo as string;
    const vcsProvider = config.vcsProvider as VCSProviderType;

    // The card the release screen shows while this runs; the publish step turns it into the report.
    const bot = await unifiedBotUserService.getBotByBotId('xyne-release-bot', workspaceId);
    const actor = bot?.id ?? release.createdBy;
    const cardId = await postLoadingMessage(release.conversationId, actor);
    void releaseRepository
      .createReleaseEvent({
        releaseId: release.id,
        eventType: ReleaseEventType.RELEASE,
        eventName: 'COMMIT_ANALYSIS_STARTED',
        message: `Commit analysis started for ${owner}/${repo} (${deployedCommitId.slice(0, 8)} → ${newCommitId.slice(0, 8)})`,
        userId: actor,
        userName: 'Xyne Release',
        channelId: release.channelId,
        conversationId: release.conversationId,
      })
      .catch(() => undefined);

    try {
      const vcs = await buildVcsClient(vcsProvider);
      const analysis = new CommitAnalysisService(vcs);
      const results = await analysis.analyzeCommits({
        deployedCommitId,
        newCommitId,
        branch,
        projectKey: owner,
        repositorySlug: repo,
        workspaceId,
        ticketPrefix: config.ticketPrefix as string,
      });

      const allFilePaths = [...new Set(results.flatMap((result) => result.filePaths ?? []))];
      const appMatchSummary = allFilePaths.length ? await analysis.getApplicationMatchSummary(boardId, allFilePaths) : [];
      const apps = allFilePaths.length ? await analysis.detectAffectedApplications(boardId, allFilePaths) : [];
      const tickets = await applicationRepository.createApplicationSubTickets({
        parentTicketId: release.id,
        parentTitle: release.title,
        projectId: release.projectId,
        channelId: release.channelId,
        conversationId: release.conversationId,
        createdBy: actor,
        affectedApplications: apps,
        prLinksByApplication: buildPRLinksByApplication(results, apps),
        isHotFix: release.ticketType === BaseTicketType.Hotfix,
      });

      const services: AnalyzeCommitRangeOutput['services'] = [];
      for (const app of apps) {
        const ticket = tickets.get(app.id);
        if (!ticket) throw new Error(`No service ticket for ${app.name}`);
        const own = filterResultsByApplication(results, app.matchedFiles);
        const detector = new ChangeDetector({ envPatterns: app.envPaths ?? [], migrationPatterns: app.migrationPaths ?? [] });
        const changes: AnalyzeCommitRangeOutput['services'][number]['changes'] = [];
        for (const result of own) {
          const { envChanges, migrationChanges } = detector.categorize(result.fileChanges);
          for (const [kind, files] of [['ENV', envChanges], ['MIGRATION', migrationChanges]] as const) {
            for (const file of files) {
              changes.push({
                serviceXyneId: ticket.xyneId,
                kind,
                filePath: file.path,
                diff: await vcs.getFileDiff(owner, repo, result.commitId, file.path),
                commitId: result.commitId,
                sourceXyneId: result.ticket?.xyneId ?? null,
                fileStatus: file.changeType.toLowerCase(),
              });
            }
          }
        }
        services.push({
          id: app.id,
          name: app.name,
          xyneId: ticket.xyneId,
          subTicketId: ticket.subTicketId,
          mappedTicketId: ticket.mappedTicketId,
          xyneIds: [...new Set(own.flatMap((result) => (result.ticket ? [result.ticket.xyneId] : [])))],
          matchedFiles: app.matchedFiles,
          changes,
        });
      }
      return { vcsProvider, owner, repo, deployedCommitId, newCommitId, results, appMatchSummary, services };
    } catch (error) {
      // The release screen shows this card; without it a failed analysis would read "Analyzing commits..." forever.
      const message = error instanceof Error ? error.message : 'Unknown error occurred';
      await conversationService
        .updateMessageContent({
          messageId: cardId,
          content: `<p><strong>Commit analysis failed</strong></p><p><em>${escapeHtml(message)}</em></p>`,
          metadata: { messageSubtype: 'commit_analysis_error', isError: true },
        })
        .catch(() => undefined);
      throw error;
    }
  }
}
