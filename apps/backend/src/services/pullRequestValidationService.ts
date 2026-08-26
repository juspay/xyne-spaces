import { TicketRepository } from '@/database/repositories/ticketRepository';
import { PRMetricsRepository } from '@/database/repositories/pullRequestsRepository';
import { BitbucketManager } from '@/bitbucket/apis';
import { githubManager } from '@/git-providers/github/apis';
import { logger } from '@/utils/logger';
import { sanitizeProjectCode, isValidProjectCode, VCSProviderType } from '@xyne/shared';

// PR validation constants (shared by the Bitbucket and GitHub webhook paths)
const PR_VALIDATION_CONFIG = {
  PR_TITLE_PATTERN: /^(?:(?:feat|fix):\s+)?([^\s-]+)-\s*(\d+)\s*[:\s]/i,
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
    // Bitbucket build-status key (dedupes statuses per commit).
    KEY: 'xyne-ticket-check',
    // Display name: Bitbucket build-status `name`, GitHub commit-status `context`.
    NAME: 'Ticket Validation',
  },
} as const;

interface ValidationResult {
  isValid: boolean;
  errorMessage?: string;
  ticketId?: string;
}

/**
 * Where the "Ticket Validation" result is reported. Bitbucket's build-status API is
 * keyed by commit alone (server-wide); GitHub's commit-status API needs the repo too.
 */
export type BuildStatusTarget =
  | { provider: VCSProviderType.BITBUCKET_SERVER }
  | { provider: VCSProviderType.GITHUB; owner: string; repo: string };

const DEFAULT_BUILD_STATUS_TARGET: BuildStatusTarget = { provider: VCSProviderType.BITBUCKET_SERVER };

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
    workspaceId: string,
    repoName?: string,
    repoUrl?: string,
    prUrl?: string,
    numberOfComments?: number,
    target: BuildStatusTarget = DEFAULT_BUILD_STATUS_TARGET,
  ): Promise<ValidationResult> {
    try {
      logger.debug(`[PR-Validation] Validating PR ${prId}: ${prTitle}`);
      const normalizedTitle = prTitle.trim();
      const ticketIdMatch = normalizedTitle.match(PR_VALIDATION_CONFIG.PR_TITLE_PATTERN);
      const rawProjectCode = ticketIdMatch?.[1];

      // Validate project code using the same rules as project creation
      const hasValidProjectCode =
        rawProjectCode !== undefined &&
        sanitizeProjectCode(rawProjectCode) === rawProjectCode &&
        isValidProjectCode(rawProjectCode);

      if (!ticketIdMatch || !hasValidProjectCode) {
        const errorMessage = PR_VALIDATION_CONFIG.ERROR_MESSAGES.INVALID_FORMAT;
        await this.postFailedBuildStatus(target, commitHash, errorMessage);
        return { isValid: false, errorMessage };
      }

      const ticketId = `${ticketIdMatch[1]}-${ticketIdMatch[2]}`;
      logger.info(`[PR-Validation] Validating PR ${prId} against ticket ${ticketId}`);

      const ticket = await this.ticketRepository.getTicketByXyneId(ticketId, workspaceId);


      if (!ticket) {
        const errorMessage = PR_VALIDATION_CONFIG.ERROR_MESSAGES.TICKET_NOT_FOUND(ticketId);
        await this.postFailedBuildStatus(target, commitHash, errorMessage);
        return { isValid: false, errorMessage, ticketId };
      }

      if (ticket.status === 'RESOLVED') {
        const errorMessage = PR_VALIDATION_CONFIG.ERROR_MESSAGES.TICKET_ALREADY_RESOLVED(ticketId);
        await this.postFailedBuildStatus(target, commitHash, errorMessage);
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
            const errorMessage = PR_VALIDATION_CONFIG.ERROR_MESSAGES.DUPLICATE_PR(ticketId);
            await this.postFailedBuildStatus(target, commitHash, errorMessage);
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
          const successMessage = PR_VALIDATION_CONFIG.ERROR_MESSAGES.VALIDATION_PASSED;
          await this.postSuccessfulBuildStatus(target, commitHash, successMessage);
          return { isValid: true, ticketId: resolvedTicketId };
        }

        // Duplicate PR is manual (no workflowExecutionId), reject it
        logger.debug(`[PR-Validation] Duplicate PR ${duplicatePR.prId} is manual, rejecting`);
        const errorMessage = PR_VALIDATION_CONFIG.ERROR_MESSAGES.DUPLICATE_PR(ticketId);
        await this.postFailedBuildStatus(target, commitHash, errorMessage);
        return { isValid: false, errorMessage, ticketId };
      }

      const successMessage = PR_VALIDATION_CONFIG.ERROR_MESSAGES.VALIDATION_PASSED;
      await this.postSuccessfulBuildStatus(target, commitHash, successMessage);
      logger.info(`[PR-Validation] PR ${prId} passed validation for ticket ${ticketId}`);

      // Validation service only validates - storage is handled by webhook handlers
      return { isValid: true, ticketId: ticket.id };
    } catch (error) {
      logger.error('[PR-Validation] Unexpected error during validation:', error);
      const errorMessage = PR_VALIDATION_CONFIG.ERROR_MESSAGES.INTERNAL_ERROR;
      await this.postFailedBuildStatus(target, commitHash, errorMessage);
      return { isValid: false, errorMessage };
    }
  }
  
  private async postSuccessfulBuildStatus(
    target: BuildStatusTarget,
    commitHash: string,
    description: string
  ): Promise<void> {
    await this.postBuildStatus(target, commitHash, true, description);
  }

  private async postFailedBuildStatus(
    target: BuildStatusTarget,
    commitHash: string,
    description: string
  ): Promise<void> {
    await this.postBuildStatus(target, commitHash, false, description);
  }

  /**
   * Report the validation outcome on the commit so it shows as a check on the PR.
   * Never throws: a status-API failure must not change the validation verdict.
   */
  private async postBuildStatus(
    target: BuildStatusTarget,
    commitHash: string,
    success: boolean,
    description: string
  ): Promise<void> {
    try {
      if (target.provider === VCSProviderType.GITHUB) {
        await githubManager.postCommitStatus(
          target.owner,
          target.repo,
          commitHash,
          success ? 'success' : 'failure',
          PR_VALIDATION_CONFIG.BUILD_STATUS.NAME,
          description,
        );
        return;
      }
      await this.bitbucketManager.postBuildStatus(
        commitHash,
        success ? 'SUCCESSFUL' : 'FAILED',
        PR_VALIDATION_CONFIG.BUILD_STATUS.KEY,
        PR_VALIDATION_CONFIG.BUILD_STATUS.NAME,
        process.env.FRONTEND_URL || '',
        description,
      );
    } catch (error) {
      logger.error(
        `[PR-Validation] Failed to post ${success ? 'successful' : 'failed'} build status (${target.provider}):`,
        error
      );
    }
  }
}

// Export singleton instance
export const pullRequestValidationService = new PullRequestValidationService();
