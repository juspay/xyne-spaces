import { Request, Response } from 'express';
import { CommitAnalysisService, CommitAnalysisResult } from '@/services/commitAnalysisService';
import { BitbucketService } from '@/services/bitbucketService';
import { TicketRepository } from '@/database/repositories/ticketRepository';
import { ApplicationRepository } from '@/database/repositories/applicationRepository';
import { ConversationRepository } from '@/database/repositories/conversationRepository';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { conversationService } from '@/services/conversationService';
import { BitbucketConfig } from '@/types/bitbucket';
import { AffectedApplicationInfo, ReleaseService } from '@/services/release/core/';
import { ReleaseRepository } from '@/database/repositories/releaseRepository';
import { createCommitAnalysisCanvas } from '@/utils/commitAnalysisCanvas';

async function postLoadingMessage(conversationId: string, userId: string): Promise<string> {
  const message = await conversationService.addMessageToConversation({
    conversationId,
    userId,
    content: `<p><strong>Analyzing commits...</strong></p><p><em>Please wait while we analyze the commits and detect affected applications.</em></p>`,
    msgType: 'SYSTEM',
    metadata: {
      messageSubtype: 'commit_analysis_loading',
      isLoading: true,
    },
  });

  return message.message.messageId;
}


export interface CommitAnalysisParams {
  workspace: string;
  repoSlug: string;
  conversationId: string;
  userId: string;
  channelId?: string;
  newCommitId: string;
  deployedCommitId: string;
  branch: string;
  parentTicketId?: string;
  userName?: string;
  isHotFix?: boolean;
  workspaceId: string;
}

// Analysis result type
export interface CommitAnalysisResponse {
  success: boolean;
  data?: CommitAnalysisResult[];
  error?: string;
  canvasUrl?: string;
}

export class CommitAnalysisController {
  private commitAnalysisService: CommitAnalysisService | null = null;
  private bitbucketService: BitbucketService | null = null;
  private releaseService: ReleaseService | null = null;
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
      this.bitbucketService &&
      this.commitAnalysisService &&
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
    const bitbucketConfig = config.bitbucket;
    const hasToken = Boolean(bitbucketConfig.apiToken);
    const hasBasicAuth =
      Boolean(bitbucketConfig.apiUsername) && Boolean(bitbucketConfig.password);

    if (!hasToken && !hasBasicAuth) {
      logger.info("Bitbucket integration not configured. Please provide either username/password or token.")
    }

    const configObj: BitbucketConfig = {
      baseUrl: bitbucketConfig.baseUrl ? `${bitbucketConfig.baseUrl}/rest/api/latest` : 'https://bitbucket.example.com/rest/api/latest',
      username: bitbucketConfig.apiUsername || '',
      password: bitbucketConfig.password || '',
      token: bitbucketConfig.apiToken || '',
    };
    this.bitbucketService = new BitbucketService(configObj);
    this.commitAnalysisService = new CommitAnalysisService(this.bitbucketService);
    this.releaseService = new ReleaseService(this.commitAnalysisService);
  }

  async analyzeCommits(params: CommitAnalysisParams): Promise<CommitAnalysisResponse> {
    const {
      workspace,
      repoSlug,
      conversationId,
      userId,
      channelId,
      newCommitId,
      deployedCommitId,
      branch,
      parentTicketId,
      userName,
      isHotFix
    } = params;

    let loadingMessageId: string | null = null;

    try {
      // Resolve project from channel
      const projectId = channelId
        ? await this.resolveProjectId(channelId)
        : null;

      logger.info(
        `Commit analysis request: ${workspace}/${repoSlug} by user ${userId}`
      );

      // Post loading indicator
      loadingMessageId = await postLoadingMessage(conversationId, userId);

      const analysisRequest = {
        deployedCommitId,
        newCommitId,
        branch,
        projectKey: workspace,
        repositorySlug: repoSlug,
      };

      const results = await this.commitAnalysisService!.analyzeCommits(analysisRequest);

      // If we have a ticket and applications, run the release orchestration
      const currentTicketId = await this.conversationRepository!.getTicketIdByConversationId(conversationId);
      let affectedApplications: AffectedApplicationInfo[] = [];
      let migrationLinks: Array<{ filePath: string; diffUrl: string }> = [];
      let envChanges: Array<{ fileName: string; filePath: string; newValue: string }> = [];

      if (projectId && currentTicketId) {
        const releaseResult = await this.releaseService!.release(
          analysisRequest,
          {
            workspace,
            repoSlug,
            projectId,
            channelId: channelId || '',
            conversationId,
            userId,
            userName: userName || userId,
            currentTicketId,
            isHotFix,
          }
        );

        affectedApplications = releaseResult.affectedApplications;
        migrationLinks = releaseResult.migrationLinks;
        envChanges = releaseResult.envChanges;

        // Update deployed commits if we have a new commit ID
        if (newCommitId && affectedApplications.length > 0) {
          const applicationIds = affectedApplications.map((app) => app.id);
          await this.releaseService!.updateDeployedCommits(applicationIds, newCommitId);
        }

        // Post to parent ticket conversation if this is a sub-ticket
        if (parentTicketId) {
          await this.postToParentTicket(
            parentTicketId,
            results,
            workspace,
            repoSlug,
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
      const shouldCreateCanvas = results.length > 0;

      if (shouldCreateCanvas) {
        const canvasViewAccessId = await createCommitAnalysisCanvas(
          results,
          affectedApplications,
          envChanges,
          migrationLinks,
          userId,
          {
            projectId,
            conversationId,
            channelId,
            workspace,
            repoSlug,
            deployedCommitId,
            newCommitId,
            affectedApplicationCount: affectedApplications.length,
            migrationCount: migrationLinks.length,
            envChangeCount: envChanges.length,
            workspaceId: params.workspaceId,
          }
        );

        if (canvasViewAccessId) {
          canvasUrl = `${config.slackFrontendUrl}/chat/canvas/${canvasViewAccessId}`;
        }
      }

      // Create a concise summary for the message
      const totalCommits = results.length;
      const commitsWithPR = results.filter((r) => r.pullRequest !== null).length;
      const commitsWithTicket = results.filter((r) => r.ticket !== null).length;

      let summaryContent = `<p><strong>📦 Release Analysis Complete</strong></p>`;
      summaryContent += `<p class="m-0 leading-6"><em class="text-gray-600">${workspace}/${repoSlug}</em></p>`;
      summaryContent += `<p class="m-0 leading-6"><em class="text-gray-600">${totalCommits} commits analyzed • ${commitsWithPR} with PRs • ${commitsWithTicket} with tickets</em></p>`;

      if (affectedApplications.length > 0) {
        summaryContent += `<p class="m-0 leading-6 mt-2"><strong class="font-semibold">Services to be deployed:</strong></p>`;
        summaryContent += `<blockquote class="border-l-4 border-gray-400 pl-4 text-gray-700">`;
        for (const app of affectedApplications.slice(0, 5)) {
          summaryContent += `<p class="m-0 leading-6"><strong class="font-semibold">${app.name}</strong></p>`;
        }
        if (affectedApplications.length > 5) {
          summaryContent += `<p class="m-0 leading-6"><em class="text-gray-600">... and ${affectedApplications.length - 5} more</em></p>`;
        }
        summaryContent += `</blockquote>`;
      }

      // Add migration and env change indicators
      summaryContent += `<p class="m-0 leading-6 mt-2"><strong class="font-semibold">Migration Change: ${migrationLinks.length > 0 ? 'Yes' : 'No'}</strong></p>`;
      summaryContent += `<p class="m-0 leading-6"><strong class="font-semibold">Env Change: ${envChanges.length > 0 ? 'Yes' : 'No'}</strong></p>`;

      // Add canvas link if created
      if (canvasUrl) {
        summaryContent += `<p class="m-0 leading-6 mt-3"><a target="_blank" rel="noopener noreferrer" class="text-blue-600 underline cursor-pointer hover:text-blue-700" href="${canvasUrl}">📄 View Full Analysis Report →</a></p>`;
      }

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
   * Resolves project ID from channel
   */
  private async resolveProjectId(channelId: string): Promise<string | null> {
    const channel = await db.channel.findUnique({
      where: { id: channelId },
      select: { projectId: true },
    });
    return channel?.projectId || null;
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
        const canvasViewAccessId = await createCommitAnalysisCanvas(
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

        if (canvasViewAccessId) {
          canvasUrl = `${config.slackFrontendUrl}/chat/canvas/${canvasViewAccessId}`;
        }
      }

      // Create concise summary for parent ticket
      const totalCommits = results.length;
      const commitsWithPR = results.filter((r) => r.pullRequest !== null).length;
      const commitsWithTicket = results.filter((r) => r.ticket !== null).length;

      let parentSummaryContent = `<p><strong>📦 Release Analysis - Sub-ticket Update</strong></p>`;

      // Add sub-ticket link if available
      if (currentTicket && channelId) {
        const subTicketUrl = `${config.slackFrontendUrl}/chat/${channelId}?tab=tickets&ticketId=${currentTicket.id}&conversationId=${conversationId}`;
        parentSummaryContent += `<p class="m-0 leading-6"><em class="text-gray-600">Sub-Ticket: <a target="_blank" rel="noopener noreferrer" class="text-blue-600 underline cursor-pointer hover:text-blue-700" href="${subTicketUrl}">${currentTicket.xyneId}</a></em></p>`;
      }

      parentSummaryContent += `<p class="m-0 leading-6"><em class="text-gray-600">${workspace}/${repoSlug}</em></p>`;
      parentSummaryContent += `<p class="m-0 leading-6"><em class="text-gray-600">${totalCommits} commits analyzed • ${commitsWithPR} with PRs • ${commitsWithTicket} with tickets</em></p>`;

      if (affectedApplications.length > 0) {
        parentSummaryContent += `<p class="m-0 leading-6 mt-2"><strong class="font-semibold">Services affected:</strong></p>`;
        parentSummaryContent += `<blockquote class="border-l-4 border-gray-400 pl-4 text-gray-700">`;
        for (const app of affectedApplications.slice(0, 5)) {
          parentSummaryContent += `<p class="m-0 leading-6"><strong class="font-semibold">${app.name}</strong></p>`;
        }
        if (affectedApplications.length > 5) {
          parentSummaryContent += `<p class="m-0 leading-6"><em class="text-gray-600">... and ${affectedApplications.length - 5} more</em></p>`;
        }
        parentSummaryContent += `</blockquote>`;
      }

      parentSummaryContent += `
      <p class="m-0 leading-6 mt-2"><strong class="font-semibold">Migration Change: ${migrationLinks && migrationLinks.length > 0 ? 'Yes' : 'No'}</strong></p>
      `;
      parentSummaryContent += `<p class="m-0 leading-6"><strong class="font-semibold">Env Change: ${envChanges && envChanges.length > 0 ? 'Yes' : 'No'}</strong></p>`;

      if (canvasUrl) {
        parentSummaryContent += `<p class="m-0 leading-6 mt-3"><a target="_blank" rel="noopener noreferrer" class="text-blue-600 underline cursor-pointer hover:text-blue-700" href="${canvasUrl}">📄 View Full Analysis Report →</a></p>`;
      }

      await conversationService.addMessageToConversation({
        conversationId: parentTicket.conversationId,
        userId,
        content: parentSummaryContent,
        msgType: 'SYSTEM',
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
      const isErrorContent = errorMessage.includes('404') && errorMessage.toLowerCase().includes('bitbucket')
        ? `<p><strong>Error: Repository or commit not found</strong></p><p><em>${errorMessage}</em></p>`
        : `<p><strong>Commit analysis failed</strong></p><p><em>${errorMessage}</em></p>`;

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
   * Get the latest deployed commit ID across all applications
   */
  getLatestDeployedCommitId = async (_req: Request, res: Response): Promise<void> => {
    try {
      const latestCommitId = await this.applicationRepository!.getLatestDeployedCommitId();

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
