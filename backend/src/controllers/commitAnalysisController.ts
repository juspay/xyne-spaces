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
import { formatCommitAnalysisMessage } from '@/utils/commitAnalysisMessageFormatter';
import { BitbucketConfig } from '@/types/bitbucket';
import { prepareResultsContent, ReleaseService } from '@/services/release/core/';
import { ReleaseRepository } from '@/database/repositories/releaseRepository';

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

async function getInitialMessageId(conversationId: string | null): Promise<string | undefined> {
  if (!conversationId) return undefined;
  const message = await db.message.findFirst({
    where: { conversationId },
    orderBy: { createdAt: 'asc' }
  });
  return message?.messageId;
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
}

// Analysis result type
export interface CommitAnalysisResponse {
  success: boolean;
  data?: CommitAnalysisResult[];
  error?: string;
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
      let affectedApplications: Array<{
        id: string;
        name: string;
        subTicketId?: string;
        mappedTicketId?: string;
        matchedFiles: string[];
      }> = [];
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
            envChanges,
            migrationLinks
          );
        }
      }

      // Format and update the message with results
      const currentTicket = currentTicketId
        ? await this.ticketRepository!.getTicketById(currentTicketId)
        : null;
      const parentTicket = parentTicketId
        ? await this.ticketRepository!.getTicketById(parentTicketId)
        : null;

      const messageId = Boolean(parentTicketId && currentTicket) ?
        await getInitialMessageId(parentTicket?.conversationId ?? null) :
        currentTicket ?
          await getInitialMessageId(currentTicket.conversationId) : undefined;

      const resultsContent = prepareResultsContent(
        results,
        workspace,
        repoSlug,
        conversationId,
        channelId,
        affectedApplications,
        currentTicket,
        parentTicket,
        loadingMessageId,
        parentTicketId,
        envChanges,
        migrationLinks,
        messageId
      );

      await conversationService.updateMessageContent({
        messageId: loadingMessageId,
        content: resultsContent,
        metadata: {
          messageSubtype: 'commit_analysis_report',
        },
      });

      return {
        success: true,
        data: results,
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
    affectedApplications: Array<{ id: string; name: string; matchedFiles: string[] }>,
    userId: string,
    envChanges?: Array<{ filePath: string; fileName: string; newValue: string }>,
    migrationLinks?: Array<{ filePath: string; diffUrl: string }>
  ): Promise<void> {
    try {
      const parentTicket = await this.ticketRepository!.getTicketById(parentTicketId);
      if (!parentTicket?.conversationId) return;

      const subTicketInitialMessage = await getInitialMessageId(conversationId);
      const currentTicket = await this.ticketRepository!.getTicketById(
        await this.conversationRepository!.getTicketIdByConversationId(conversationId) || ''
      );

      const parentResultsContent = formatCommitAnalysisMessage(
        results,
        workspace,
        repoSlug,
        10000,
        conversationId,
        channelId,
        affectedApplications,
        currentTicket
          ? {
            isSubTicket: false,
            ticketId: currentTicket.id,
            xyneId: currentTicket.xyneId,
            conversationId,
            messageId: subTicketInitialMessage,
          }
          : undefined,
        envChanges,
        migrationLinks
      );

      await conversationService.addMessageToConversation({
        conversationId: parentTicket.conversationId,
        userId,
        content: parentResultsContent,
        msgType: 'SYSTEM',
        metadata: {
          messageSubtype: 'commit_analysis_report',
          fromSubTicket: true,
          subTicketConversationId: conversationId,
        },
      });

      logger.info(`Posted commit analysis to parent ticket ${parentTicket.xyneId} conversation`);
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
