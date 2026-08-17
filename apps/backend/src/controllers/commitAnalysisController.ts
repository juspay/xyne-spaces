import { Request, Response } from 'express';
import { CommitAnalysisService, CommitAnalysisResult, AnalyzeCommitsRequest } from '@/services/commitAnalysisService';
import { TicketRepository } from '@/database/repositories/ticketRepository';
import { ApplicationRepository } from '@/database/repositories/applicationRepository';
import { ConversationRepository } from '@/database/repositories/conversationRepository';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { conversationService } from '@/services/conversationService';
import { AffectedApplicationInfo, ReleaseService } from '@/services/release/core/';
import { ReleaseRepository } from '@/database/repositories/releaseRepository';
import { createCommitAnalysisCanvas, upsertCommitAnalysisCanvas } from '@/utils/commitAnalysisCanvas';
import { parseBitbucketRepoUrl, parseGitHubRepoUrl } from '@/utils/repoUrlParser';
import { escapeHtml } from '@/utils/htmlEscape';
import { isSameCommit } from '@/utils/commitIds';
import { buildVcsClient } from '@/services/release/buildVcsClient';
import { ReleaseTrackingMode, VCSProviderType, MessageType } from '@xyne/shared';

// Shared HTML for the release and parent-ticket analysis summary cards.
function buildAnalysisSummaryHtml(opts: {
  header: string;
  // already-escaped extra line after the header (e.g. the sub-ticket link)
  prefaceHtml?: string;
  workspace: string;
  repoSlug: string;
  totalCommits: number;
  commitsWithPR: number;
  commitsWithTicket: number;
  affectedApplications: AffectedApplicationInfo[];
  servicesLabel: string;
  // per-app regex match table (main card only)
  appMatchSummary?: Array<{ name: string; regex: string; matchCount: number; regexValid: boolean }>;
  hasMigrationChange: boolean;
  hasEnvChange: boolean;
  canvasUrl?: string;
}): string {
  const {
    header, prefaceHtml, workspace, repoSlug, totalCommits, commitsWithPR, commitsWithTicket,
    affectedApplications, servicesLabel, appMatchSummary, hasMigrationChange, hasEnvChange, canvasUrl,
  } = opts;

  let html = `<p><strong>${header}</strong></p>`;
  if (prefaceHtml) html += prefaceHtml;
  html += `<p class="m-0 leading-6"><em class="text-gray-600">${escapeHtml(workspace)}/${escapeHtml(repoSlug)}</em></p>`;
  html += `<p class="m-0 leading-6"><em class="text-gray-600">${totalCommits} commits analyzed • ${commitsWithPR} with PRs • ${commitsWithTicket} with tickets</em></p>`;

  if (affectedApplications.length > 0) {
    html += `<p class="m-0 leading-6 mt-2"><strong class="font-semibold">${servicesLabel}</strong></p>`;
    html += `<blockquote class="border-l-4 border-gray-400 pl-4 text-gray-700">`;
    for (const app of affectedApplications.slice(0, 5)) {
      html += `<p class="m-0 leading-6"><strong class="font-semibold">${escapeHtml(app.name)}</strong></p>`;
    }
    if (affectedApplications.length > 5) {
      html += `<p class="m-0 leading-6"><em class="text-gray-600">... and ${affectedApplications.length - 5} more</em></p>`;
    }
    html += `</blockquote>`;
  }

  // distinguish regex-matched-0-files from matched-but-no-changes
  if (appMatchSummary && appMatchSummary.length > 0) {
    const matchedCount = appMatchSummary.filter(a => a.matchCount > 0).length;
    const invalid = appMatchSummary.filter(a => !a.regexValid);
    html += `<p class="m-0 leading-6 mt-2"><strong class="font-semibold">Applications matched: ${matchedCount}/${appMatchSummary.length}</strong></p>`;
    html += `<blockquote class="border-l-4 border-gray-300 pl-4 text-gray-700">`;
    for (const row of appMatchSummary) {
      const icon = row.matchCount > 0 ? '✅' : (row.regexValid ? '⚠️' : '❌');
      // user-configured — escape before HTML
      const safeRegex = escapeHtml(row.regex);
      const note = !row.regexValid
        ? ` <em class="text-red-600">(invalid regex: <code>${safeRegex}</code>)</em>`
        : row.matchCount === 0
          ? ` <em class="text-amber-600">(regex <code>${safeRegex}</code> matched 0 files — check config)</em>`
          : '';
      html += `<p class="m-0 leading-6">${icon} <strong>${escapeHtml(row.name)}</strong>: ${row.matchCount} file${row.matchCount === 1 ? '' : 's'}${note}</p>`;
    }
    html += `</blockquote>`;
    if (invalid.length > 0) {
      html += `<p class="m-0 leading-6 text-red-600 text-sm"><em>⚠️ Fix the invalid regex above — those apps will never match.</em></p>`;
    }
  }

  html += `<p class="m-0 leading-6 mt-2"><strong class="font-semibold">Migration Change: ${hasMigrationChange ? 'Yes' : 'No'}</strong></p>`;
  html += `<p class="m-0 leading-6"><strong class="font-semibold">Env Change: ${hasEnvChange ? 'Yes' : 'No'}</strong></p>`;

  if (canvasUrl) {
    html += `<p class="m-0 leading-6 mt-3"><a target="_blank" rel="noopener noreferrer" class="text-blue-600 underline cursor-pointer hover:text-blue-700" href="${canvasUrl}">📄 View Full Analysis Report →</a></p>`;
  }
  return html;
}

// Subtypes that mark THE single release-analysis message in a conversation.
const ANALYSIS_MESSAGE_SUBTYPES = [
  'commit_analysis_report',
  'commit_analysis_loading',
  'commit_analysis_error',
];

async function postLoadingMessage(conversationId: string, userId: string): Promise<string> {
  const loadingContent = `<p><strong>Analyzing commits...</strong></p><p><em>Please wait while we analyze the commits and detect affected applications.</em></p>`;
  const loadingMeta = { messageSubtype: 'commit_analysis_loading', isLoading: true };

  // One analysis message per release conversation: reuse and update the existing
  // one in place instead of posting a fresh card each run (avoids duplicates).
  const existing = await db.message.findMany({
    where: {
      conversationId,
      isDeleted: false,
      OR: ANALYSIS_MESSAGE_SUBTYPES.map((s) => ({
        metadata: { path: ['messageSubtype'], equals: s },
      })),
    },
    orderBy: { createdAt: 'asc' },
    select: { messageId: true },
  });

  if (existing.length > 0) {
    const canonicalId = existing[0].messageId;
    // Collapse any duplicates left by earlier runs (before this dedup existed)
    // into the single canonical message.
    const dupeIds = existing.slice(1).map((m) => m.messageId);
    if (dupeIds.length > 0) {
      await db.message.updateMany({
        where: { messageId: { in: dupeIds } },
        data: { isDeleted: true },
      });
    }
    await conversationService.updateMessageContent({
      messageId: canonicalId,
      content: loadingContent,
      metadata: loadingMeta,
    });
    return canonicalId;
  }

  const message = await conversationService.addMessageToConversation({
    conversationId,
    userId,
    content: loadingContent,
    msgType: MessageType.SYSTEM,
    metadata: loadingMeta,
  });
  return message.message.messageId;
}


export interface CommitAnalysisParams {
  conversationId: string;
  userId: string;
  channelId?: string;
  newCommitId: string;
  deployedCommitId: string;
  branch: string;
  parentTicketId?: string;
  // The release ticket whose creation triggered this analysis. Caller passes
  // it directly — avoids the fragile getTicketIdByConversationId lookup.
  currentTicketId: string;
  userName?: string;
  isHotFix?: boolean;
  workspaceId: string;
  // Set by the webhook release-sync path. When true, deployedCommitId/newCommitId
  // carry the HOTFIX DELTA range (frozen release head → new branch head), the
  // per-app sub-tickets are tagged as hotfixes, and the canvas is upserted into
  // the "🔥 Hotfix PRs" section instead of rebuilding the main analysis.
  hotfixSync?: boolean;
}

// Analysis result type
export interface CommitAnalysisResponse {
  success: boolean;
  data?: CommitAnalysisResult[];
  error?: string;
  canvasUrl?: string;
}

export class CommitAnalysisController {
  // VCS client + analysis/release services are now constructed per-request in
  // analyzeCommits() so the right provider (Bitbucket Server vs GitHub) can be
  // selected from board.vcsProvider. Repositories are still cached on the
  // instance — they don't depend on the VCS provider.
  private ticketRepository: TicketRepository | null = null;
  private applicationRepository: ApplicationRepository | null = null;
  private conversationRepository: ConversationRepository | null = null;
  private releaseRepository: ReleaseRepository | null = null;
  constructor() {
    try {
      this.initializeServices();
    } catch (error) {
      logger.error('Failed to initialize CommitAnalysisController services:', error);
    }
  }

  private initializeServices(): void {
    if (
      this.ticketRepository &&
      this.applicationRepository &&
      this.conversationRepository &&
      this.releaseRepository
    ) {
      return;
    }

    this.ticketRepository = new TicketRepository();
    this.applicationRepository = new ApplicationRepository();
    this.conversationRepository = new ConversationRepository();
    this.releaseRepository = new ReleaseRepository();
  }

  private async deriveReleaseContext(
    releaseTicketId: string,
  ): Promise<{
    projectId: string;
    mainReleaseBoardId: string;
    projectKey: string;
    repoSlug: string;
    code: string | null;
    vcsProvider: 'BITBUCKET_SERVER' | 'GITHUB';
  } | null> {
    const ticket = await db.ticket.findUnique({
      where: { id: releaseTicketId },
      select: {
        projectId: true,
        boardId: true,
        project: { select: { code: true } },
        board: {
          select: {
            boardType: true,
            vcsProvider: true,
            releaseTrackingMode: true,
          },
        },
      },
    });

    if (!ticket?.boardId || !ticket.board) {
      return null;
    }

    if (ticket.board.releaseTrackingMode !== ReleaseTrackingMode.COMMIT_RANGE) {
      logger.warn(
        `[ReleaseTrigger] skipped: board ${ticket.boardId} releaseTrackingMode=${ticket.board.releaseTrackingMode ?? 'null'}`,
      );
      return null;
    }

    const provider = ticket.board.vcsProvider;
    if (provider !== VCSProviderType.BITBUCKET_SERVER && provider !== VCSProviderType.GITHUB) {
      logger.warn(
        `[ReleaseTrigger] skipped: board ${ticket.boardId} vcsProvider=${provider ?? 'null'} — only BITBUCKET_SERVER and GITHUB are wired`,
      );
      return null;
    }

    const apps =
      await this.applicationRepository!.findByMainReleaseBoardId(ticket.boardId);
    if (apps.length === 0) {
      logger.warn(`[ReleaseTrigger] skipped: main release board ${ticket.boardId} has zero applications`);
      return null;
    }

    const repoUrls = [
      ...new Set(apps.map(app => app.repoUrl.trim().replace(/\/+$/, ''))),
    ];
    if (repoUrls.length !== 1 || !repoUrls[0]) {
      logger.error(
        `[ReleaseTrigger] skipped: main release board ${ticket.boardId} has invalid repository URLs (${repoUrls.join(', ')})`,
      );
      return null;
    }

    let projectKey: string;
    let repoSlug: string;
    if (provider === VCSProviderType.GITHUB) {
      const parsed = parseGitHubRepoUrl(repoUrls[0]);
      if (!parsed) {
        logger.warn(`[ReleaseTrigger] skipped: cannot parse GitHub repoUrl ${repoUrls[0]}`);
        return null;
      }
      // For GitHub, owner→projectKey and repo→repoSlug. The strings flow through
      // the analysis pipeline unchanged; only the upstream API differs.
      projectKey = parsed.owner;
      repoSlug = parsed.repo;
    } else {
      const parsed = parseBitbucketRepoUrl(repoUrls[0]);
      if (!parsed) {
        logger.warn(`[ReleaseTrigger] skipped: cannot parse Bitbucket repoUrl ${repoUrls[0]}`);
        return null;
      }
      projectKey = parsed.projectKey;
      repoSlug = parsed.repoSlug;
    }

    return {
      projectId: ticket.projectId,
      mainReleaseBoardId: ticket.boardId,
      projectKey,
      repoSlug,
      code: ticket.project.code,
      vcsProvider: provider,
    };
  }

  async analyzeCommits(params: CommitAnalysisParams): Promise<CommitAnalysisResponse> {
    const {
      conversationId,
      userId,
      channelId,
      newCommitId,
      deployedCommitId,
      branch,
      parentTicketId,
      currentTicketId,
      userName,
      isHotFix,
      hotfixSync,
    } = params;

    let loadingMessageId: string | null = null;

    try {
      const derived = await this.deriveReleaseContext(currentTicketId);

      if (!derived) {
        logger.warn('[ReleaseTrigger] skipped: no workspace/repoSlug available');
        return { success: false, error: 'Release board is not configured for commit analysis' };
      }

      const {
        projectId,
        mainReleaseBoardId,
        projectKey: derivedProjectKey,
        repoSlug: derivedRepoSlug,
        code: projectCode,
        vcsProvider: derivedVcsProvider,
      } = derived;

      logger.info(
        `Commit analysis request: ${derivedProjectKey}/${derivedRepoSlug} (provider=${derivedVcsProvider}) by user ${userId} (derived from Application.repoUrl)`,
      );

      // Post loading indicator
      loadingMessageId = await postLoadingMessage(conversationId, userId);

      const analysisRequest: AnalyzeCommitsRequest = {
        deployedCommitId,
        newCommitId,
        branch,
        projectKey: derivedProjectKey,
        repositorySlug: derivedRepoSlug,
        workspaceId: params.workspaceId,
        // Project's local code drives the dev-ticket-id regex (e.g. 'TSP').
        // Falls through to 'XYNE' in the service if absent.
        ...(projectCode && { ticketPrefix: projectCode }),
      };

      // Build a provider-specific VCS client + downstream services per request
      // so board.vcsProvider picks between BitbucketService and GitHubService.
      const vcsClient = buildVcsClient(derivedVcsProvider as VCSProviderType);
      const commitAnalysisService = new CommitAnalysisService(vcsClient);
      const releaseService = new ReleaseService(commitAnalysisService);

      const results = await commitAnalysisService.analyzeCommits(analysisRequest);

      // getCommitsBetween() appends the boundary (deployedCommitId) commit to the
      // range. For a hotfix sync that boundary is the FROZEN release head — a
      // main PR — so drop it from the view: the "🔥 Hotfix PRs" section and the
      // hotfix summary must not list the last main PR as a hotfix. Persistence is
      // unaffected (release() dedups the boundary against the existing release).
      // prefix compare — deployedCommitId may be an abbreviated SHA
      const viewResults = hotfixSync
        ? results.filter((r) => !isSameCommit(r.commitId, deployedCommitId))
        : results;

      let affectedApplications: AffectedApplicationInfo[] = [];
      let migrationLinks: Array<{ filePath: string; diffUrl: string }> = [];
      let envChanges: Array<{ fileName: string; filePath: string; newValue: string; commitId?: string }> = [];
      let appMatchSummary: Array<{ name: string; regex: string; matchCount: number; regexValid: boolean }> = [];

      if (projectId && currentTicketId) {
        const releaseResult = await releaseService.release(
          analysisRequest,
          {
            workspace: derivedProjectKey,
            repoSlug: derivedRepoSlug,
            projectId,
            mainReleaseBoardId,
            channelId: channelId || '',
            conversationId,
            userId,
            userName: userName || userId,
            currentTicketId,
            // A hotfix sync tags the delta's per-app sub-tickets as hotfixes.
            isHotFix: hotfixSync ? true : isHotFix,
          }
        );

        affectedApplications = releaseResult.affectedApplications;
        migrationLinks = releaseResult.migrationLinks;
        envChanges = releaseResult.envChanges;
        appMatchSummary = releaseResult.appMatchSummary;

        // Update deployed commits if we have a new commit ID
        if (newCommitId && affectedApplications.length > 0) {
          const applicationIds = affectedApplications.map((app) => app.id);
          await releaseService.updateDeployedCommits(applicationIds, newCommitId);
        }

        // Post to parent ticket conversation if this is a sub-ticket
        if (parentTicketId) {
          await this.postToParentTicket(
            parentTicketId,
            results,
            derivedProjectKey,
            derivedRepoSlug,
            conversationId,
            channelId,
            affectedApplications,
            userId,
            deployedCommitId,
            newCommitId,
            envChanges,
            migrationLinks
          );
        }
      }

      // Create canvas for detailed analysis
      let canvasUrl: string | undefined;
      const shouldCreateCanvas = viewResults.length > 0;

      if (shouldCreateCanvas) {
        // One canvas per release: upsert (locate by conversationId + source and
        // update in place) instead of minting a new canvas each run. A hotfix
        // sync writes into the "🔥 Hotfix PRs" section and preserves the main
        // analysis; a main run preserves any existing hotfix section.
        const canvasId = await upsertCommitAnalysisCanvas({
          section: hotfixSync ? 'hotfix' : 'main',
          results: viewResults,
          affectedApplications,
          envChanges,
          migrationLinks,
          createdByUserId: userId,
          metadata: {
            projectId,
            conversationId,
            channelId,
            workspace: derivedProjectKey,
            repoSlug: derivedRepoSlug,
            deployedCommitId,
            newCommitId,
            affectedApplicationCount: affectedApplications.length,
            migrationCount: migrationLinks.length,
            envChangeCount: envChanges.length,
            workspaceId: params.workspaceId,
          },
        });

        if (canvasId) {
          canvasUrl = `${config.slackFrontendUrl}/chat/canvas/${canvasId}`;
        }
      }

      // Create a concise summary for the message
      const totalCommits = viewResults.length;
      const commitsWithPR = viewResults.filter((r) => r.pullRequest !== null).length;
      const commitsWithTicket = viewResults.filter((r) => r.ticket !== null).length;

      const summaryContent = buildAnalysisSummaryHtml({
        header: hotfixSync ? '🔥 Hotfix Analysis Complete' : '📦 Release Analysis Complete',
        workspace: derivedProjectKey,
        repoSlug: derivedRepoSlug,
        totalCommits,
        commitsWithPR,
        commitsWithTicket,
        affectedApplications,
        servicesLabel: 'Services to be deployed:',
        appMatchSummary,
        hasMigrationChange: migrationLinks.length > 0,
        hasEnvChange: envChanges.length > 0,
        canvasUrl,
      });

      await conversationService.updateMessageContent({
        messageId: loadingMessageId,
        content: summaryContent,
        metadata: {
          messageSubtype: 'commit_analysis_report',
          canvasUrl: canvasUrl || undefined,
        },
      });

      return {
        success: true,
        data: results,
        canvasUrl,
      };
    } catch (error) {
      await this.handleError(error, loadingMessageId);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }


  /**
   * Posts analysis results to parent ticket conversation
   */
  private async postToParentTicket(
    parentTicketId: string,
    results: CommitAnalysisResult[],
    workspace: string,
    repoSlug: string,
    conversationId: string,
    channelId: string | undefined,
    affectedApplications: AffectedApplicationInfo[],
    userId: string,
    deployedCommitId: string,
    newCommitId: string,
    envChanges?: Array<{ filePath: string; fileName: string; newValue: string }>,
    migrationLinks?: Array<{ filePath: string; diffUrl: string }>
  ): Promise<void> {
    try {
      const parentTicket = await this.ticketRepository!.getTicketById(parentTicketId);
      if (!parentTicket?.conversationId) return;

      const currentTicket = await this.ticketRepository!.getTicketById(
        await this.conversationRepository!.getTicketIdByConversationId(conversationId) || ''
      );

      let canvasUrl: string | undefined;
      if (results.length > 0) {
        const canvasId = await createCommitAnalysisCanvas(
          results,
          affectedApplications,
          envChanges,
          migrationLinks,
          userId,
          {
            channelId,
            workspace,
            repoSlug,
            deployedCommitId,
            newCommitId,
            affectedApplicationCount: affectedApplications.length,
            migrationCount: migrationLinks?.length || 0,
            envChangeCount: envChanges?.length || 0,
          }
        );

        if (canvasId) {
          canvasUrl = `${config.slackFrontendUrl}/chat/canvas/${canvasId}`;
        }
      }

      // Create concise summary for parent ticket
      const totalCommits = results.length;
      const commitsWithPR = results.filter((r) => r.pullRequest !== null).length;
      const commitsWithTicket = results.filter((r) => r.ticket !== null).length;

      const subTicketPreface = currentTicket && channelId
        ? (() => {
            const subTicketUrl = `${config.slackFrontendUrl}/chat/${channelId}?tab=tickets&ticketId=${currentTicket.id}&conversationId=${conversationId}`;
            return `<p class="m-0 leading-6"><em class="text-gray-600">Sub-Ticket: <a target="_blank" rel="noopener noreferrer" class="text-blue-600 underline cursor-pointer hover:text-blue-700" href="${subTicketUrl}">${escapeHtml(currentTicket.xyneId)}</a></em></p>`;
          })()
        : undefined;

      const parentSummaryContent = buildAnalysisSummaryHtml({
        header: '📦 Release Analysis - Sub-ticket Update',
        prefaceHtml: subTicketPreface,
        workspace,
        repoSlug,
        totalCommits,
        commitsWithPR,
        commitsWithTicket,
        affectedApplications,
        servicesLabel: 'Services affected:',
        hasMigrationChange: Boolean(migrationLinks && migrationLinks.length > 0),
        hasEnvChange: Boolean(envChanges && envChanges.length > 0),
        canvasUrl,
      });

      await conversationService.addMessageToConversation({
        conversationId: parentTicket.conversationId,
        userId,
        content: parentSummaryContent,
        msgType: MessageType.SYSTEM,
        metadata: {
          messageSubtype: 'commit_analysis_report',
          fromSubTicket: true,
          subTicketConversationId: conversationId,
          canvasUrl: canvasUrl || undefined,
        },
      });

      logger.info(`Posted commit analysis to parent ticket ${parentTicket.xyneId} conversation with canvas`);
    } catch (error) {
      logger.error('Failed to post commit analysis to parent ticket:', error);
    }
  }

  /**
   * Handles errors by updating the loading message
   */
  private async handleError(error: unknown, loadingMessageId: string | null): Promise<void> {
    logger.error('Commit analysis failed:', error);

    if (!loadingMessageId) return;

    try {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      // error text can echo user input — escape before HTML
      const safeError = escapeHtml(errorMessage);
      const isErrorContent = errorMessage.includes('404') && errorMessage.toLowerCase().includes('bitbucket')
        ? `<p><strong>Error: Repository or commit not found</strong></p><p><em>${safeError}</em></p>`
        : `<p><strong>Commit analysis failed</strong></p><p><em>${safeError}</em></p>`;

      await conversationService.updateMessageContent({
        messageId: loadingMessageId,
        content: isErrorContent,
        metadata: {
          messageSubtype: 'commit_analysis_error',
          isError: true,
        },
      });
    } catch (updateError) {
      logger.error('Failed to update loading message with error:', updateError);
    }
  }

  /**
   * Get the latest deployed commit ID for one main release board.
   */
  getLatestDeployedCommitId = async (req: Request, res: Response): Promise<void> => {
    try {
      const mainReleaseBoardId =
        typeof req.query.mainReleaseBoardId === 'string'
          ? req.query.mainReleaseBoardId
          : null;
      if (!mainReleaseBoardId) {
        res.status(400).json({ error: 'mainReleaseBoardId is required' });
        return;
      }
      const latestCommitId =
        await this.applicationRepository!.getLatestDeployedCommitId(mainReleaseBoardId);

      res.status(200).json({ latestCommitId });
    } catch (error) {
      logger.error('Failed to get latest deployed commit ID:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get latest deployed commit ID',
        timestamp: new Date().toISOString(),
      });
    }
  };
}
