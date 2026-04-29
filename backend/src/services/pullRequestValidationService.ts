import { TicketRepository } from '@/database/repositories/ticketRepository';
import { PRMetricsRepository } from '@/database/repositories/pullRequestsRepository';
import { BitbucketManager } from '@/bitbucket/apis';
import { logger } from '@/utils/logger';

// Bitbucket PR validation configuration constants
const BITBUCKET_PR_CONFIG = {
  PR_TITLE_PATTERN: /^(?:(?:feat|fix):\s+)?([A-Z][A-Z0-9]{2,})-\s*(\d+)\s*[:\s]/i,
  ERROR_MESSAGES: {
    INVALID_FORMAT: 'PR title must format: PROJECT-####: description OR feat/fix: PROJECT-####:subject OR feat/fix: PROJECT-#### subject',
    TICKET_NOT_FOUND: (ticketId: string) => `Ticket ${ticketId} does not exist`,
    TICKET_ALREADY_RESOLVED: (ticketId: string) => `Ticket ${ticketId} is already resolved`,
    DUPLICATE_PR: (ticketId: string) =>
      `Duplicate PR already exists for ticket ${ticketId} with same branches`,
    VALIDATION_PASSED: 'PR validation passed',
    INTERNAL_ERROR: 'Internal error during PR validation',
  },
  BUILD_STATUS: {
    KEY: 'xyne-ticket-check',
    NAME: 'Ticket Validation',
    SUCCESS_URL: 'https://xyne.juspay.net',
    FAILED_URL: 'https://spaces.xyne.juspay.net',
  },
} as const;

interface ValidationResult {
  isValid: boolean;
  errorMessage?: string;
  ticketId?: string;
}

export class PullRequestValidationService {
  private ticketRepository: TicketRepository;
  private prMetricsRepository: PRMetricsRepository;
  private bitbucketManager: BitbucketManager;

  constructor() {
    this.ticketRepository = new TicketRepository();
    this.prMetricsRepository = new PRMetricsRepository();
    this.bitbucketManager = new BitbucketManager();
  }

  async validatePullRequest(
    prTitle: string,
    prId: number,
    commitHash: string,
    sourceBranch: string,
    destinationBranch: string,
    repoName?: string,
    repoUrl?: string,
    prUrl?: string,
    numberOfComments?: number,
  ): Promise<ValidationResult> {
    try {
      logger.debug(`[PR-Validation] Validating PR ${prId}: ${prTitle}`);
      const normalizedTitle = prTitle.trim();
      const ticketIdMatch = normalizedTitle.match(BITBUCKET_PR_CONFIG.PR_TITLE_PATTERN);
      
      if (!ticketIdMatch) {
        const errorMessage = BITBUCKET_PR_CONFIG.ERROR_MESSAGES.INVALID_FORMAT;
        await this.postFailedBuildStatus(commitHash, errorMessage);
        return { isValid: false, errorMessage };
      }

      const ticketId = `${ticketIdMatch[1]}-${ticketIdMatch[2]}`;
      logger.info(`[PR-Validation] Validating PR ${prId} against ticket ${ticketId}`);

      const ticket = await this.ticketRepository.getTicketByXyneId(ticketId);


      if (!ticket) {
        const errorMessage = BITBUCKET_PR_CONFIG.ERROR_MESSAGES.TICKET_NOT_FOUND(ticketId);
        await this.postFailedBuildStatus(commitHash, errorMessage);
        return { isValid: false, errorMessage, ticketId };
      }

      if (ticket.status === 'RESOLVED') {
        const errorMessage = BITBUCKET_PR_CONFIG.ERROR_MESSAGES.TICKET_ALREADY_RESOLVED(ticketId);
        await this.postFailedBuildStatus(commitHash, errorMessage);
        return { isValid: false, errorMessage, ticketId };
      }

      const duplicatePR = await this.prMetricsRepository.findDuplicatePR(
        ticket.id,
        sourceBranch,
        destinationBranch,
        prId
      );

      if (duplicatePR) {
        // Check if the duplicate PR was created via workflow (has workflowExecutionId)
        // If so, update the PR instead of rejecting (only for pr:created webhook)
        if (duplicatePR.workflowExecutionId) {
          logger.debug(
            `[PR-Validation] Duplicate PR ${duplicatePR.prId} has workflowExecutionId, ` +
              `updating instead of rejecting`
          );

          // Get ticketId - first try from the existing PR, then fallback to workflow chain
          let resolvedTicketId = duplicatePR.ticketId;

          if (!resolvedTicketId) {
            logger.warn(
              `[PR-Validation] ticketId missing on workflow PR ${duplicatePR.prId}, ` +
                `falling back to chain lookup`
            );
            resolvedTicketId = await this.prMetricsRepository.getTicketIdForWorkflowExecution(
              duplicatePR.workflowExecutionId
            );
          }

          if (!resolvedTicketId) {
            // Chain lookup failed, reject as duplicate
            logger.warn(
              `[PR-Validation] Workflow chain lookup failed for PR ${duplicatePR.prId}, ` +
                `rejecting duplicate`
            );
            const errorMessage = BITBUCKET_PR_CONFIG.ERROR_MESSAGES.DUPLICATE_PR(ticketId);
            await this.postFailedBuildStatus( commitHash, errorMessage);
            return { isValid: false, errorMessage, ticketId };
          }

          // Update the PR with new details
          if (repoName && repoUrl && prUrl && numberOfComments !== undefined) {
            try {
              await this.prMetricsRepository.createOrUpdatePR({
                prId,
                prUrl,
                repoName,
                repoUrl,
                sourceBranchName: sourceBranch,
                destinationBranchName: destinationBranch,
                numberOfComments,
                ticketId: resolvedTicketId,
              });
              logger.info(`[PR-Validation] Updated workflow PR ${prId} for ticket ${ticketId}`);
            } catch (error) {
              logger.error(`[PR-Validation] Failed to update workflow PR ${prId}:`, error);
            }
          }

          // Post success and return valid
          const successMessage = BITBUCKET_PR_CONFIG.ERROR_MESSAGES.VALIDATION_PASSED;
          await this.postSuccessfulBuildStatus( commitHash, successMessage);
          return { isValid: true, ticketId: resolvedTicketId };
        }

        // Duplicate PR is manual (no workflowExecutionId), reject it
        logger.debug(`[PR-Validation] Duplicate PR ${duplicatePR.prId} is manual, rejecting`);
        const errorMessage = BITBUCKET_PR_CONFIG.ERROR_MESSAGES.DUPLICATE_PR(ticketId);
        await this.postFailedBuildStatus( commitHash, errorMessage);
        return { isValid: false, errorMessage, ticketId };
      }

      const successMessage = BITBUCKET_PR_CONFIG.ERROR_MESSAGES.VALIDATION_PASSED;
      await this.postSuccessfulBuildStatus( commitHash, successMessage);
      logger.info(`[PR-Validation] PR ${prId} passed validation for ticket ${ticketId}`);

      // Validation service only validates - storage is handled by webhook handlers
      return { isValid: true, ticketId: ticket.id };
    } catch (error) {
      logger.error('[PR-Validation] Unexpected error during validation:', error);
      const errorMessage = BITBUCKET_PR_CONFIG.ERROR_MESSAGES.INTERNAL_ERROR;
      await this.postFailedBuildStatus(commitHash, errorMessage);
      return { isValid: false, errorMessage };
    }
  }
  
  private async postSuccessfulBuildStatus(
    commitHash: string,
    description: string
  ): Promise<void> {
    try {
      await this.bitbucketManager.postBuildStatus(
        commitHash,
        'SUCCESSFUL',
        BITBUCKET_PR_CONFIG.BUILD_STATUS.KEY,
        BITBUCKET_PR_CONFIG.BUILD_STATUS.NAME,
        process.env.FRONTEND_URL || '' ,
        description,
      );
    } catch (error) {
      logger.error('[PR-Validation] Failed to post successful build status:', error);
    }
  }

  private async postFailedBuildStatus(
    commitHash: string,
    description: string
  ): Promise<void> {
    try {
      await this.bitbucketManager.postBuildStatus(
        commitHash,
        'FAILED',
        BITBUCKET_PR_CONFIG.BUILD_STATUS.KEY,
        BITBUCKET_PR_CONFIG.BUILD_STATUS.NAME,
        process.env.FRONTEND_URL || '' ,
        description
      );
    } catch (error) {
      logger.error('[PR-Validation] Failed to post failed build status:', error);
    }
  }
}

// Export singleton instance
export const pullRequestValidationService = new PullRequestValidationService();
