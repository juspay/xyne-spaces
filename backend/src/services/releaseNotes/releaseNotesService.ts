import { CommitAnalysisService } from '@/services/commitAnalysisService';
import { TicketRepository } from '@/database/repositories/ticketRepository';
import { FormsRepository } from '@/database/repositories/formsRepository';
import { MessageRepository } from '@/database/repositories/messageRepository';
import { ConversationService } from '@/services/conversationService';
import { logger } from '@/utils/logger';
import { generateReleaseNotesContent, ReleaseNotesGeneratorInput } from '@/services/agents/release-notes/release-notes-agent';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';
import { config } from '@/config/env';
import { AgentsConfig } from '@/agents/config';
import { FormEntityType } from '@xyne/shared';
import { BitbucketService } from '@/services/bitbucketService';

type LinkedPrTicket = {
  prId: number;
  prUrl: string;
  title: string;
  description: string | null;
  potVideoLink: string | null;
  ticket: {
    id: string;
    xyneId: string;
    title: string;
    description: string | null;
    conversationId: string | null;
  } | null;
}

export interface ReleaseNotesContext {
  release: {
    ticketId: string;
    xyneId: string;
    title: string;
    description: string | null;
    channelId: string;
    conversationId: string;
  };
  prs: LinkedPrTicket[];
  conversationMessages: Array<{
    content: string;
    senderName: string;
    createdAt: string;
  }>;
  hotfixPRs: LinkedPrTicket[]
}

export class ReleaseNotesService {
  private commitAnalysisService: CommitAnalysisService | null = null;
  private ticketRepository: TicketRepository | null = null;
  private formsRepository: FormsRepository | null = null;
  private messageRepository: MessageRepository | null = null;
  private conversationService: ConversationService | null = null;

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    try {
      this.ticketRepository = new TicketRepository();
      this.formsRepository = new FormsRepository();
      this.messageRepository = new MessageRepository();
      this.conversationService = new ConversationService();

      const bitbucketConfig = config.bitbucket;
      const hasToken = Boolean(bitbucketConfig.apiToken);
      const hasBasicAuth = Boolean(bitbucketConfig.apiUsername) && Boolean(bitbucketConfig.password);

      if (hasToken || hasBasicAuth) {
        const bitbucketService = new BitbucketService({
          baseUrl: bitbucketConfig.baseUrl || 'https://bitbucket.example.com/rest/api/latest',
          username: bitbucketConfig.apiUsername || '',
          password: bitbucketConfig.password || '',
          token: bitbucketConfig.apiToken || '',
        });
        this.commitAnalysisService = new CommitAnalysisService(bitbucketService);
      }

      logger.info('[ReleaseNotesService] Successfully initialized');
    } catch (error) {
      logger.error('[ReleaseNotesService] Failed to initialize:', error);
    }
  }

  async gatherReleaseData(ticketId: string): Promise<ReleaseNotesContext> {
    if (!this.ticketRepository) {
      throw new Error('Ticket repository not initialized');
    }

    const ticket = await this.ticketRepository.getTicketById(ticketId);
    if (!ticket) {
      throw new Error(`Ticket ${ticketId} not found`);
    }

    const prs = await this.gatherPRData(ticketId);
    const conversationMessages = await this.gatherConversationMessages(ticket.conversationId);
    const hotfixPRs = await this.gatherHotfixPRs(ticketId);
    return {
      release: {
        ticketId: ticket.id,
        xyneId: ticket.xyneId,
        title: ticket.title,
        description: ticket.description,
        channelId: ticket.channelId,
        conversationId: ticket.conversationId,
      },
      prs,
      conversationMessages,
      hotfixPRs,
    };
  }

  private async gatherConversationMessages(
    conversationId: string
  ): Promise<ReleaseNotesContext['conversationMessages']> {
    if (!this.messageRepository || !conversationId) {
      return [];
    }

    try {
      const messages = await this.messageRepository.getConversationMessages(
        conversationId,
      );

      if (!Array.isArray(messages)) {
        return [];
      }

      return messages.map(msg => ({
        content: extractPlainTextFromHtml(msg.content || ''),
        senderName: msg.senderId || 'Unknown',
        createdAt: msg.createdAt.toISOString(),
      }));
    } catch (error) {
      logger.error('[ReleaseNotesService] Failed to gather conversation messages:', error);
      return [];
    }
  }

  private async gatherPRData(ticketId: string): Promise<ReleaseNotesContext['prs']> {
    if (!this.ticketRepository || !this.commitAnalysisService || !this.formsRepository) {
      return [];
    }

    const prs: ReleaseNotesContext['prs'] = [];

    try {

      const formValues = await this.formsRepository.getFormEntityValuesByEntityId(
        ticketId,
        FormEntityType.TICKET
      );

      const deployedCommitId = formValues.deployedCommitId as string;
      const newCommitId = formValues.newCommitId as string;
      const branch = (formValues.branch as string) || 'main';
      // TODO: Replace hardcoded values with actual configuration from project/board settings
      const workspace = 'XYNE';
      const repoSlug = 'xyne-spaces';

      if (!deployedCommitId || !newCommitId) {
        logger.warn(`[ReleaseNotesService] Missing commit IDs in form values for ticket ${ticketId}`);
        return prs;
      }

      const results = await this.commitAnalysisService.analyzeCommits({
        deployedCommitId,
        newCommitId,
        projectKey: workspace,
        repositorySlug: repoSlug,
        branch,
      });

      if (!results || results.length === 0) {
        logger.warn(`[ReleaseNotesService] No commit analysis results for ticket ${ticketId}`);
        return prs;
      }

      const processedPRs = new Set<number>();

      for (const result of results) {
        if (!result.pullRequest) continue;

        const prId = result.pullRequest.id;
        if (processedPRs.has(prId)) continue;
        processedPRs.add(prId);

        const ticketIdFromPR = this.extractTicketId(result.pullRequest.title);
        const linkedTicket = ticketIdFromPR ? await this.fetchTicketByXyneId(ticketIdFromPR) : null;

        const potVideoLink = this.extractPotVideoLink(result.pullRequest.description);

        prs.push({
          prId: result.pullRequest.id,
          prUrl: result.pullRequest.url,
          title: result.pullRequest.title,
          description: result.pullRequest.description || null,
          potVideoLink,
          ticket: linkedTicket,
        });
      }

      logger.info(`[ReleaseNotesService] Gathered ${prs.length} PRs for release notes`);
    } catch (error) {
      logger.error(`[ReleaseNotesService] Error gathering PR data:`, error);
    }

    return prs;
  }

  private extractTicketId(prTitle: string): string | null {
    const match = prTitle.match(/^(XYNE-\d+)/);
    if (match) {
      return match[1];
    }
    const anywhereMatch = prTitle.match(/XYNE-\d+/);
    if (anywhereMatch) {
      return anywhereMatch[0];
    }
    return null;
  }

  private async fetchTicketByXyneId(xyneId: string): Promise<LinkedPrTicket['ticket'] | null> {
    if (!this.ticketRepository) {
      return null;
    }

    try {
      const ticket = await this.ticketRepository.getTicketByXyneId(xyneId);
      if (!ticket) {
        return null;
      }
      return {
        id: ticket.id,
        xyneId: ticket.xyneId,
        title: ticket.title,
        description: ticket.description,
        conversationId: ticket.conversationId,
      };
    } catch (error) {
      logger.error(`[ReleaseNotesService] Error fetching ticket ${xyneId}:`, error);
      return null;
    }
  }

  extractPotVideoLink(description: string | undefined): string | null {
    if (!description) {
      return null;
    }

    const lines = description.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      const normalizedLine = line.replace(/\*+/g, '').replace(/^\d+\.\s*/, '').trim().toLowerCase();
      const isTestingSection = normalizedLine === 'testing';

      if (line.includes('**POT**') || line.includes('POT:') || line.includes('Proof of Testing') || isTestingSection) {
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j].trim();

          if (nextLine.length === 0) {
            continue;
          }

          const urlMatch = nextLine.match(/(https?:\/\/[^\s\)\]\n]+)/);
          if (urlMatch) {
            return urlMatch[1];
          }

          break;
        }
      }
    }

    const urlRegex = /(https?:\/\/(?:www\.)?(?:loom\.com|drive\.google\.com|youtube\.com|youtu\.be|vimeo\.com)[^\s\)\]\n]*)/i;
    const match = description.match(urlRegex);
    if (match) {
      return match[1];
    }

    return null;
  }

  async generateReleaseNotesMarkdown(context: ReleaseNotesContext): Promise<string | null> {
    if (context.prs.length === 0) {
      return null
    }

    try {
      // If 15 or fewer PRs, use single LLM call
      if (context.prs.length <= 15) {
        return await this.generateSingleBatch(context);
      }

      // If more than 15 PRs, split into batches and process in parallel
      return await this.generateBatchedNotes(context);
    } catch (error) {
      logger.error('[ReleaseNotesService] Release notes generation failed:', error);
      return null;
    }
  }

  private categorizePRs(prs: ReleaseNotesContext['prs']) {
    const categories = {
      features: [] as typeof prs,
      fixes: [] as typeof prs,
      others: [] as typeof prs,
    };

    for (const pr of prs) {
      const title = pr.title.toLowerCase();

      // Check for feat/feature keywords
      if (title.includes('feat') || title.includes('feature')) {
        categories.features.push(pr);
      }
      // Check for fix keywords
      else if (title.includes('fix')) {
        categories.fixes.push(pr);
      }
      // Everything else
      else {
        categories.others.push(pr);
      }
    }

    return categories;
  }

  private async generateSingleBatch(context: ReleaseNotesContext): Promise<string> {
    const agentsConfig = await AgentsConfig.fetch();

    const agentInput: ReleaseNotesGeneratorInput = {
      releaseXyneId: context.release.xyneId,
      releaseTitle: context.release.title,
      releaseDescription: context.release.description,
      prs: context.prs.map(pr => ({
        prId: pr.prId,
        title: pr.title,
        description: pr.description,
        hasPotVideo: !!pr.potVideoLink,
        ticketXyneId: pr.ticket?.xyneId || null,
        ticketTitle: pr.ticket?.title || null,
        ticketDescription: pr.ticket?.description || null,
      })),
      conversationMessages: context.conversationMessages,
      hotfixPRs: context.hotfixPRs.map(pr => ({
        prId: pr.prId,
        title: pr.title,
        description: pr.description,
        hasPotVideo: !!pr.potVideoLink,
        ticketXyneId: pr.ticket?.xyneId || null,
        ticketTitle: pr.ticket?.title || null,
        ticketDescription: pr.ticket?.description || null,
      })),
    };


    const content = await generateReleaseNotesContent(
      agentInput,
      {},
      undefined,
      agentsConfig
    );
    const header = `### 📝 Release Notes: ${context.release.xyneId}\n\n**${context.release.title}**\n\n`;

    return header + content;
  }

  private async generateBatchedNotes(context: ReleaseNotesContext): Promise<string> {
    const categorized = this.categorizePRs(context.prs);
    const agentsConfig = await AgentsConfig.fetch();
    // Create batch promises for parallel execution
    const batchPromises: Promise<string>[] = [];

    // Process hotfix PRs first (as a separate category)
    if (context.hotfixPRs.length > 0) {
      batchPromises.push(
        this.generateCategoryBatch(
          'HOTFIXES',
          '🔥 Hotfixes',
          context.hotfixPRs,
          context,
          agentsConfig
        )
      );
    }

    if (categorized.features.length > 0) {
      batchPromises.push(
        this.generateCategoryBatch(
          'NEW_FEATURES',
          '✨ New Features',
          categorized.features,
          context,
          agentsConfig
        )
      );
    }

    if (categorized.fixes.length > 0) {
      batchPromises.push(
        this.generateCategoryBatch(
          'BUG_FIXES',
          '🐛 Bug Fixes',
          categorized.fixes,
          context,
          agentsConfig
        )
      );
    }

    if (categorized.others.length > 0) {
      batchPromises.push(
        this.generateCategoryBatch(
          'IMPROVEMENTS',
          '⚡ Improvements',
          categorized.others,
          context,
          agentsConfig
        )
      );
    }

    // Execute all batches in parallel
    const batchResults = await Promise.all(batchPromises);

    // Combine results
    const header = `### 📝 Release Notes: ${context.release.xyneId}\n\n**${context.release.title}**\n\n`;

    return header + batchResults.join('\n\n');
  }

  private async generateCategoryBatch(
    category: string,
    categoryTitle: string,
    prs: ReleaseNotesContext['prs'],
    context: ReleaseNotesContext,
    agentsConfig: AgentsConfig
  ): Promise<string> {
    const MAX_PRS_PER_BATCH = 15;

    // If category has 15 or fewer PRs, process in single call
    if (prs.length <= MAX_PRS_PER_BATCH) {
      const agentInput: ReleaseNotesGeneratorInput = {
        releaseXyneId: context.release.xyneId,
        releaseTitle: context.release.title,
        releaseDescription: context.release.description,
        prs: prs.map(pr => ({
          prId: pr.prId,
          title: pr.title,
          description: pr.description,
          hasPotVideo: !!pr.potVideoLink,
          ticketXyneId: pr.ticket?.xyneId || null,
          ticketTitle: pr.ticket?.title || null,
          ticketDescription: pr.ticket?.description || null,
        })),
        conversationMessages: context.conversationMessages,
        categoryFocus: category,
      };

      const sectionContent = await generateReleaseNotesContent(
        agentInput,
        {},
        undefined,
        agentsConfig
      );

      return `## ${categoryTitle}\n\n${sectionContent}`;
    }

    // If category has more than 15 PRs, split into sub-batches
    logger.info(`[ReleaseNotesService] Category ${category} has ${prs.length} PRs, splitting into sub-batches`);

    const subBatches: Promise<string>[] = [];

    for (let i = 0; i < prs.length; i += MAX_PRS_PER_BATCH) {
      const batchPRs = prs.slice(i, i + MAX_PRS_PER_BATCH);
      const batchNumber = Math.floor(i / MAX_PRS_PER_BATCH) + 1;
      const totalBatches = Math.ceil(prs.length / MAX_PRS_PER_BATCH);

      const agentInput: ReleaseNotesGeneratorInput = {
        releaseXyneId: context.release.xyneId,
        releaseTitle: context.release.title,
        releaseDescription: context.release.description,
        prs: batchPRs.map(pr => ({
          prId: pr.prId,
          title: pr.title,
          description: pr.description,
          hasPotVideo: !!pr.potVideoLink,
          ticketXyneId: pr.ticket?.xyneId || null,
          ticketTitle: pr.ticket?.title || null,
          ticketDescription: pr.ticket?.description || null,
        })),
        conversationMessages: context.conversationMessages,
        categoryFocus: category,
      };

      subBatches.push(
        generateReleaseNotesContent(agentInput, {}, undefined, agentsConfig)
          .then(content => {
            logger.info(`[ReleaseNotesService] Completed sub-batch ${batchNumber}/${totalBatches} for ${category}`);
            return content;
          })
      );
    }

    // Execute all sub-batches in parallel
    const subBatchResults = await Promise.all(subBatches);

    // Combine sub-batch results (just concatenate, no category header for sub-batches)
    const combinedContent = subBatchResults.join('\n\n');

    return `## ${categoryTitle}\n\n${combinedContent}`;
  }

  private async gatherHotfixPRs(parentTicketId: string): Promise<ReleaseNotesContext['hotfixPRs']> {
    if (!this.ticketRepository) {
      return [];
    }

    try {
      // Get hotfix sub-tickets
      const hotfixSubTickets = await this.ticketRepository.getHotfixSubTickets(parentTicketId);

      if (hotfixSubTickets.length === 0) {
        return [];
      }

      logger.info(`[ReleaseNotesService] Found ${hotfixSubTickets.length} hotfix sub-tickets for ${parentTicketId}`);

      const hotfixPRs: ReleaseNotesContext['hotfixPRs'] = [];

      // Gather PRs from each hotfix sub-ticket
      for (const subTicket of hotfixSubTickets) {
        if (!subTicket.mappedTicket) continue;

        const subTicketPRs = await this.gatherPRData(subTicket.mappedTicket.id);
        hotfixPRs.push(...subTicketPRs);
      }
      return hotfixPRs;
    } catch (error) {
      logger.error(`[ReleaseNotesService] Error gathering hotfix PRs:`, error);
      return [];
    }
  }

  async notifyLinkedTickets(
    context: ReleaseNotesContext,
    canvasUrl: string,
    releaseBotId: string
  ): Promise<void> {
    if (!this.ticketRepository || !this.conversationService) {
      logger.warn('[ReleaseNotesService] Cannot notify linked tickets: missing dependencies');
      return;
    }

    const linkedTickets = new Map<string, LinkedPrTicket['ticket']>();
    for (const pr of context.prs) {
      if (pr.ticket && pr.ticket.id !== context.release.ticketId) {
        linkedTickets.set(pr.ticket.id, pr.ticket);
      }
    }

    for (const pr of context.hotfixPRs) {
      if (pr.ticket && pr.ticket.id !== context.release.ticketId) {
        linkedTickets.set(pr.ticket.id, pr.ticket);
      }
    }

    if (linkedTickets.size === 0) {
      logger.info('[ReleaseNotesService] No linked tickets to notify');
      return;
    }

    logger.info(`[ReleaseNotesService] Notifying ${linkedTickets.size} linked ticket(s) about release ${context.release.xyneId}`);

    for (const [ticketId, ticket] of linkedTickets) {
      try {
        if (!ticket?.conversationId) {
          logger.warn(`[ReleaseNotesService] Ticket ${ticketId} has no conversation, skipping notification`);
          continue;
        }

        const messageContent = `🚀 This ticket has been deployed as part of **${context.release.xyneId}**.`;

        // Post message to ticket's conversation
        await this.conversationService.addMessageToConversation({
          conversationId: ticket.conversationId,
          userId: releaseBotId,
          content: messageContent,
          msgType: 'SYSTEM',
          metadata: {
            messageSubtype: 'ticket_deployed_with_release',
            canvasUrl,
            releaseTicketId: context.release.ticketId,
            releaseTicketXyneId: context.release.xyneId,
            contentFormat: 'markdown'
          },
        });

        logger.info(`[ReleaseNotesService] Notified ticket ${ticket.xyneId} (conversation: ${ticket.conversationId})`);
      } catch (error) {
        logger.error(`[ReleaseNotesService] Failed to notify ticket ${ticketId}:`, error);
      }
    }
  }

}
