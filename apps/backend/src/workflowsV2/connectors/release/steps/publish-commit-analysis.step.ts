import { BaseActionStep, variableRef } from '@xyne/workflow-sdk';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { ReleaseEventType, VCSProviderType } from '@xyne/shared';
import type { Prisma } from '@prisma/client';
// @xyne/workflow-sdk builds its schemas with zod/v3 from the repo's zod; use that same copy.
import { z } from 'zod/v3';
import { db } from '@/database/client';
import { ReleaseRepository } from '@/database/repositories/releaseRepository';
import { buildAnalysisSummaryHtml, postLoadingMessage } from '@/controllers/commitAnalysisController';
import { CommitAnalysisService, countDistinctMigrationFiles } from '@/services/commitAnalysisService';
import type { CommitAnalysisResult } from '@/services/commitAnalysisService';
import { conversationService } from '@/services/conversationService';
import { buildWorkspaceCanvasUrl } from '@/services/canvasService';
import { buildVcsClient } from '@/services/release/buildVcsClient';
import type { AffectedApplicationInfo } from '@/services/release/core';
import { upsertCommitAnalysisCanvas } from '@/utils/commitAnalysisCanvas';
import { unifiedBotUserService } from '@/bots/unified';
import { workspaceOf } from '../../xyne-spaces/context';

const PublishCommitAnalysisConfigSchema = z.object({
  releaseTicket: variableRef(z.string().min(1)).describe('Release ticket id or ID like PLAT-12'),
  boardId: variableRef(z.string().min(1)).describe('The main release board the release is on'),
  analysis: variableRef(z.record(z.any())).describe('The whole output of Analyze commit range'),
});
type PublishCommitAnalysisConfig = z.infer<typeof PublishCommitAnalysisConfigSchema>;

const PublishCommitAnalysisOutputSchema = z.object({ canvasUrl: z.string().nullable() });
type PublishCommitAnalysisOutput = z.infer<typeof PublishCommitAnalysisOutputSchema>;

interface Analysis {
  vcsProvider: string;
  owner: string;
  repo: string;
  deployedCommitId: string;
  newCommitId: string;
  results: CommitAnalysisResult[];
  appMatchSummary: Array<{ name: string; regex: string; matchCount: number; regexValid: boolean }>;
  services: Array<{ id: string; name: string; xyneId: string; subTicketId: string; mappedTicketId: string; matchedFiles: string[] }>;
}

const releaseRepository = new ReleaseRepository();

export class PublishCommitAnalysisStep extends BaseActionStep<typeof PublishCommitAnalysisConfigSchema, PublishCommitAnalysisOutput> {
  readonly type = 'PUBLISH_COMMIT_ANALYSIS';
  readonly configSchema = PublishCommitAnalysisConfigSchema;
  readonly outputSchema = PublishCommitAnalysisOutputSchema;
  readonly name = 'Publish commit analysis';
  readonly description =
    "Writes the release's analysis canvas and turns its \"Analyzing commits...\" card into the analysis report, as the commit analysis always did. Run it after the service tickets and changes are saved.";
  readonly category = 'release';
  readonly icon = 'FileText';

  async execute(config: PublishCommitAnalysisConfig, ctx: StepExecutionContext): Promise<PublishCommitAnalysisOutput> {
    const workspaceId = workspaceOf(ctx, this.type);
    const identifier = (config.releaseTicket as string).trim();
    const boardId = config.boardId as string;
    const analysis = config.analysis as unknown as Analysis;
    const { owner, repo, results } = analysis;
    const release = await db.ticket.findFirst({
      where: { workspaceId, OR: [{ id: identifier }, { xyneId: identifier }] },
      select: { id: true, projectId: true, createdBy: true, conversationId: true, channelId: true },
    });
    if (!release) throw new Error(`Release ticket ${identifier} not found`);
    const bot = await unifiedBotUserService.getBotByBotId('xyne-release-bot', workspaceId);
    const userId = bot?.id ?? release.createdBy;

    const affectedApplications: AffectedApplicationInfo[] = analysis.services.map((service) => ({
      id: service.id,
      name: service.name,
      subTicketId: service.subTicketId,
      subTicketXyneId: service.xyneId,
      mappedTicketId: service.mappedTicketId,
      matchedFiles: service.matchedFiles,
    }));

    // What was saved, read back, so a re-run reports the whole release and not just this run.
    const vcs = await buildVcsClient(analysis.vcsProvider === VCSProviderType.GITHUB ? VCSProviderType.GITHUB : VCSProviderType.BITBUCKET_SERVER);
    const { migrationLinks, envChanges } = await new CommitAnalysisService(vcs).buildReleaseChangeSummary(owner, repo, release.id, boardId);

    let canvasUrl: string | undefined;
    if (results.length > 0) {
      const canvasId = await upsertCommitAnalysisCanvas({
        section: 'main',
        results,
        affectedApplications,
        envChanges,
        migrationLinks,
        repoSlices: [{ workspace: owner, repoSlug: repo, deployedCommitId: analysis.deployedCommitId, newCommitId: analysis.newCommitId, results, affectedApplications }],
        createdByUserId: userId,
        metadata: {
          projectId: release.projectId,
          conversationId: release.conversationId,
          channelId: release.channelId,
          workspace: owner,
          repoSlug: repo,
          deployedCommitId: analysis.deployedCommitId,
          newCommitId: analysis.newCommitId,
          affectedApplicationCount: affectedApplications.length,
          migrationCount: countDistinctMigrationFiles(migrationLinks),
          envChangeCount: envChanges.length,
          workspaceId,
        },
      });
      if (canvasId) canvasUrl = buildWorkspaceCanvasUrl(workspaceId, canvasId);
    }

    const messageId = await postLoadingMessage(release.conversationId, userId);
    await conversationService.updateMessageContent({
      messageId,
      content: buildAnalysisSummaryHtml({
        header: '📦 Release Analysis Complete',
        workspace: owner,
        repoSlug: repo,
        totalCommits: results.length,
        commitsWithPR: results.filter((result) => result.pullRequest !== null).length,
        commitsWithTicket: results.filter((result) => result.ticket !== null).length,
        affectedApplications,
        servicesLabel: 'Services to be deployed:',
        appMatchSummary: analysis.appMatchSummary,
        hasMigrationChange: migrationLinks.length > 0,
        hasEnvChange: envChanges.length > 0,
        canvasUrl,
      }),
      metadata: { messageSubtype: 'commit_analysis_report', canvasUrl: canvasUrl || undefined },
    });

    const event = (eventType: ReleaseEventType, eventName: string, message: string, applicationReleaseId?: string, payload?: Prisma.InputJsonValue) =>
      releaseRepository
        .createReleaseEvent({
          releaseId: release.id,
          applicationReleaseId,
          eventType,
          eventName,
          message,
          userId,
          userName: 'Xyne Release',
          channelId: release.channelId,
          conversationId: release.conversationId,
          payload,
        })
        .catch(() => undefined);
    for (const app of affectedApplications) {
      await event(ReleaseEventType.SUBTICKET, 'SUBTICKET_PROVISIONED', `Prepared ${app.name} (${app.matchedFiles.length} file${app.matchedFiles.length === 1 ? '' : 's'} matched)`, app.subTicketId, {
        applicationId: app.id,
        applicationName: app.name,
      });
    }
    const migrations = countDistinctMigrationFiles(migrationLinks);
    await event(
      ReleaseEventType.RELEASE,
      'COMMIT_ANALYSIS_COMPLETED',
      `Analysis complete: ${affectedApplications.length} app${affectedApplications.length === 1 ? '' : 's'} affected, ${envChanges.length} env change${envChanges.length === 1 ? '' : 's'}, ${migrations} migration${migrations === 1 ? '' : 's'}`,
      undefined,
      { affectedAppCount: affectedApplications.length, envChangeCount: envChanges.length, migrationCount: migrations },
    );
    return { canvasUrl: canvasUrl ?? null };
  }
}
