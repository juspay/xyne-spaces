import { TicketRepository } from '@/database/repositories/ticketRepository';
import { PRMetricsRepository } from '@/database/repositories/pullRequestsRepository';
import { BitbucketManager } from '@/bitbucket/apis';
import { githubManager, sanitizeForLog } from '@/git-providers/github/apis';
import {
  superpositionClient,
  type ResolvedConfigDetails,
} from '@/services/superpositionClient';
import { logger } from '@/utils/logger';
import {
  filterEnforceableSections,
  formatMissingSections,
  REQUIRED_SPEC_SECTIONS,
  validateSpecSections,
} from '@/utils/specValidation';
import { sanitizeProjectCode, isValidProjectCode, VCSProviderType, FormEntityType } from '@xyne/shared';
import { db } from '@/database/client';
import {
  resolveBoardTicketFormId,
  resolveFormFieldDefinitionsForForm,
} from '@/utils/fieldDefinition';
import { parseBitbucketPrUrl, parseBitbucketRepoUrl } from '@/utils/repoUrlParser';

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
  SPEC_MESSAGES: {
    MISSING: (ticketId: string) => `No specification on ${ticketId} - run /spec on the ticket`,
    INCOMPLETE: (ticketId: string, missing: string) => `${ticketId} spec missing: ${missing}`,
    NOT_CHECKED: 'Ticket not resolved - spec not checked',
    NOT_EVALUATED: 'Spec not evaluated - validation error',
    DISABLED: 'Spec check disabled',
    VALIDATION_PASSED: 'Specification complete',
  },
  BUILD_STATUS: {
    // Statuses are stored per COMMIT by both providers, so the key/context must
    // include the PR id: one branch can back several open PRs (e.g. the same
    // head for a main PR and a release-branch PR), and a shared context would
    // let the last-validated PR overwrite the others' result on that commit.
    // Bitbucket build-status key (dedupes statuses per commit + key).
    KEY: (prId: number) => `xyne-ticket-check-pr-${prId}`,
    // Display name: Bitbucket build-status `name`, GitHub commit-status `context`.
    NAME: (prId: number) => `Ticket Validation (#${prId})`,
  },
  // Keyed per PR for the same reason as above. No Bitbucket key: GitHub only.
  SPEC_BUILD_STATUS: {
    NAME: (prId: number) => `Spec Validation (#${prId})`,
  },
  SPEC_FLAGS: {
    ENABLED: 'pr_spec_check_enabled',
    REQUIRED_SECTIONS: 'pr_spec_required_sections',
  },
  // QA-assignee merge gate: a workspace-flagged extra ticket check. Unlike the
  // spec check (own status) it joins the main Ticket Validation status so the
  // existing Bitbucket required-builds rule enforces it with no repo change.
  QA_ASSIGNEE: {
    ENABLED_FLAG: 'pr_qa_assignee_check_enabled',
    FIELD_NAME_FLAG: 'pr_qa_assignee_field_name',
    DEFAULT_FIELD_NAME: 'QA Assignee',
    MISSING_MESSAGE: (ticketId: string, fieldName: string) =>
      `Ticket ${ticketId}: "${fieldName}" is not set on the linked ticket`,
  },
} as const;

interface ValidationResult {
  isValid: boolean;
  errorMessage?: string;
  ticketId?: string;
  /** Set when validation failed on infrastructure, not on the PR itself. */
  failureKind?: 'internal-error';
  xyneId?: string;
  ticketDescription?: string | null;
}

/**
 * Where the "Ticket Validation" result is reported. Bitbucket's build-status API is
 * keyed by commit alone (server-wide); GitHub's commit-status API needs the repo too.
 */
export type BuildStatusTarget =
  | { provider: VCSProviderType.BITBUCKET_SERVER }
  | { provider: VCSProviderType.GITHUB; owner: string; repo: string };

const DEFAULT_BUILD_STATUS_TARGET: BuildStatusTarget = { provider: VCSProviderType.BITBUCKET_SERVER };

/** Named rather than positional: the middle of this list is five strings in a
 *  row, where a transposition would typecheck and post against the wrong commit
 *  or scope config to the wrong workspace. */
export interface ValidatePullRequestParams {
  prTitle: string;
  prId: number;
  commitHash: string;
  sourceBranch: string;
  destinationBranch: string;
  workspaceId: string;
  repoName?: string;
  repoUrl?: string;
  prUrl?: string;
  numberOfComments?: number;
  target?: BuildStatusTarget;
}

// Superposition has no request timeout of its own - SUPERPOSITION_TIMEOUT is
// plumbed into refreshStrategy.timeout, which the provider never reads, and the
// bundled HTTP handler defaults to unbounded. This sits on the webhook response
// path, which GitHub gives 10s, so it needs its own bound.
const FLAG_CONFIG_TIMEOUT_MS = 2500; 

const withTimeout = async <T>(work: Promise<T>, fallback: T, label: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>(resolve => {
        timer = setTimeout(() => {
          logger.warn(`[PR-Validation] ${label} timed out after ${FLAG_CONFIG_TIMEOUT_MS}ms`);
          resolve(fallback);
        }, FLAG_CONFIG_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

type BuildStatusState = 'success' | 'failure';

const BITBUCKET_BUILD_STATE: Record<BuildStatusState, 'SUCCESSFUL' | 'FAILED'> = {
  success: 'SUCCESSFUL',
  failure: 'FAILED',
};

export class PullRequestValidationService {
  private ticketRepository: TicketRepository;
  private prMetricsRepository: PRMetricsRepository;
  private bitbucketManager: BitbucketManager;

  constructor() {
    this.ticketRepository = new TicketRepository();
    this.prMetricsRepository = new PRMetricsRepository();
    this.bitbucketManager = new BitbucketManager();
  }

  async validatePullRequest(params: ValidatePullRequestParams): Promise<ValidationResult> {
    const target = params.target ?? DEFAULT_BUILD_STATUS_TARGET;
    const { commitHash, prId, workspaceId } = params;
    const result = await this.runTicketValidation(params, target);
    // Awaited so two events for the same commit cannot post out of order; the
    // config read inside is time-bounded. Called here so no early return in
    // runTicketValidation skips it.
    await this.postSpecBuildStatus(target, commitHash, prId, workspaceId, result);
    return result;
  }

  /**
   * Re-run ticket validation for a ticket's open PRs after a form field on the
   * ticket changed. The merge-gate build status lives on the PR head commit, so
   * without this a "QA Assignee" fill/clear would not move the PR's status until
   * the next PR webhook event. Fire-and-forget: never throws, and does nothing
   * unless the QA-assignee gate is enabled for the workspace.
   */
  async maybeRevalidateOpenPrsForTicketFieldChange(args: {
    ticketId: string;
    workspaceId: string;
    changedFieldNames: string[];
  }): Promise<void> {
    try {
      // Stored PR rows are the devrepo Bitbucket lane, so the gate config is
      // resolved with the default (Bitbucket) target context.
      const config = await this.resolveQaAssigneeCheckConfig(
        DEFAULT_BUILD_STATUS_TARGET,
        args.workspaceId
      );
      if (!config.enabled) return;
      const wanted = config.fieldName.trim().toLowerCase();
      const gateFieldChanged = args.changedFieldNames.some(
        name => name.trim().toLowerCase() === wanted
      );
      if (!gateFieldChanged) return;
      await this.revalidateOpenPrsForTicket(args.ticketId, args.workspaceId);
    } catch (error) {
      logger.error('[PR-Validation] QA-assignee re-validation trigger failed:', error);
    }
  }

  private async revalidateOpenPrsForTicket(
    ticketId: string,
    workspaceId: string
  ): Promise<void> {
    const openPrs = await this.prMetricsRepository.findOpenPrsForTicket(ticketId);
    if (openPrs.length === 0) return;

    logger.info(
      `[PR-Validation] Re-validating ${openPrs.length} open PR(s) for ticket ${ticketId}`
    );
    for (const pr of openPrs) {
      try {
        const prUrlParts = parseBitbucketPrUrl(pr.prUrl);
        const repoUrlParts = prUrlParts
          ? null
          : pr.repositoryUrl
            ? parseBitbucketRepoUrl(pr.repositoryUrl)
            : null;
        const projectKey = prUrlParts?.projectKey ?? repoUrlParts?.projectKey;
        const repositorySlug = prUrlParts?.repositorySlug ?? repoUrlParts?.repoSlug;
        if (!projectKey || !repositorySlug) {
          logger.warn(
            `[PR-Validation] Cannot resolve repo for PR ${pr.prId}, skipping re-validation`
          );
          continue;
        }

        // Live PR detail is the source for title + head commit: the
        // pull_requests table stores neither, and re-validation must judge the
        // PR as it currently stands.
        const detail = await this.bitbucketManager.getPullRequest(
          projectKey,
          repositorySlug,
          pr.prId
        );
        if (!detail || detail.state !== 'OPEN') continue;
        const sourceBranch = pr.sourceBranchName || detail.fromRef?.displayId || '';
        const destinationBranch = pr.destinationBranchName || detail.toRef?.displayId || '';
        const commitHash = detail.fromRef?.latestCommit;
        if (!detail.title || !sourceBranch || !destinationBranch || !commitHash) {
          logger.warn(
            `[PR-Validation] PR ${pr.prId} re-validation skipped: incomplete Bitbucket detail`
          );
          continue;
        }

        await this.validatePullRequest({
          prTitle: detail.title,
          prId: pr.prId,
          commitHash,
          sourceBranch,
          destinationBranch,
          workspaceId,
          repoName: pr.repoName,
          repoUrl: pr.repositoryUrl,
          prUrl: pr.prUrl,
          numberOfComments: pr.numberOfComments,
          target: DEFAULT_BUILD_STATUS_TARGET,
        });
      } catch (error) {
        logger.error(`[PR-Validation] Re-validation failed for PR ${pr.prId}:`, error);
      }
    }
  }

  private async runTicketValidation(
    params: ValidatePullRequestParams,
    target: BuildStatusTarget
  ): Promise<ValidationResult> {
    const {
      prTitle,
      prId,
      commitHash,
      sourceBranch,
      destinationBranch,
      workspaceId,
      repoName,
      repoUrl,
      prUrl,
      numberOfComments,
    } = params;
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
        await this.postFailedBuildStatus(target, prId, commitHash, errorMessage);
        return { isValid: false, errorMessage };
      }

      const ticketId = `${ticketIdMatch[1]}-${ticketIdMatch[2]}`;
      logger.info(`[PR-Validation] Validating PR ${prId} against ticket ${ticketId}`);

      const ticket = await this.ticketRepository.getTicketByXyneId(ticketId, workspaceId);


      if (!ticket) {
        const errorMessage = PR_VALIDATION_CONFIG.ERROR_MESSAGES.TICKET_NOT_FOUND(ticketId);
        await this.postFailedBuildStatus(target, prId, commitHash, errorMessage);
        return { isValid: false, errorMessage, ticketId, xyneId: ticketId };
      }

      if (ticket.status === 'RESOLVED') {
        const errorMessage = PR_VALIDATION_CONFIG.ERROR_MESSAGES.TICKET_ALREADY_RESOLVED(ticketId);
        await this.postFailedBuildStatus(target, prId, commitHash, errorMessage);
        return {
          isValid: false,
          errorMessage,
          ticketId,
          xyneId: ticketId,
          ticketDescription: ticket.description,
        };
      }

      // QA-assignee merge gate (workspace flag, CAC). Only a positively
      // determined missing value blocks the PR: when the value cannot be
      // read/verified at all we fail open, so a forms or DB hiccup cannot
      // freeze every merge in the workspace.
      const qaConfig = await this.resolveQaAssigneeCheckConfig(target, workspaceId);
      if (qaConfig.enabled && ticket.boardId) {
        const qaAssigneeFilled = await this.isTicketFieldFilled(
          ticket.id,
          ticket.boardId,
          qaConfig.fieldName
        );
        if (qaAssigneeFilled === false) {
          const errorMessage = PR_VALIDATION_CONFIG.QA_ASSIGNEE.MISSING_MESSAGE(
            ticketId,
            qaConfig.fieldName
          );
          logger.info(`[PR-Validation] Blocking PR ${prId}: ${errorMessage}`);
          await this.postFailedBuildStatus(target, prId, commitHash, errorMessage);
          return {
            isValid: false,
            errorMessage,
            ticketId,
            xyneId: ticketId,
            ticketDescription: ticket.description,
          };
        }
        if (qaAssigneeFilled === null) {
          logger.warn(
            `[PR-Validation] "${qaConfig.fieldName}" not verifiable for ${ticketId}, ` +
              `not blocking merge`
          );
        }
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
            await this.postFailedBuildStatus(target, prId, commitHash, errorMessage);
            return {
              isValid: false,
              errorMessage,
              ticketId,
              xyneId: ticketId,
              ticketDescription: ticket.description,
            };
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
          await this.postSuccessfulBuildStatus(target, prId, commitHash, successMessage);
          return {
            isValid: true,
            ticketId: resolvedTicketId,
            xyneId: ticketId,
            ticketDescription: ticket.description,
          };
        }

        // Duplicate PR is manual (no workflowExecutionId), reject it
        logger.debug(`[PR-Validation] Duplicate PR ${duplicatePR.prId} is manual, rejecting`);
        const errorMessage = PR_VALIDATION_CONFIG.ERROR_MESSAGES.DUPLICATE_PR(ticketId);
        await this.postFailedBuildStatus(target, prId, commitHash, errorMessage);
        return {
          isValid: false,
          errorMessage,
          ticketId,
          xyneId: ticketId,
          ticketDescription: ticket.description,
        };
      }

      const successMessage = PR_VALIDATION_CONFIG.ERROR_MESSAGES.VALIDATION_PASSED;
      await this.postSuccessfulBuildStatus(target, prId, commitHash, successMessage);
      logger.info(`[PR-Validation] PR ${prId} passed validation for ticket ${ticketId}`);

      // Validation service only validates - storage is handled by webhook handlers
      return {
        isValid: true,
        ticketId: ticket.id,
        xyneId: ticketId,
        ticketDescription: ticket.description,
      };
    } catch (error) {
      logger.error('[PR-Validation] Unexpected error during validation:', error);
      const errorMessage = PR_VALIDATION_CONFIG.ERROR_MESSAGES.INTERNAL_ERROR;
      await this.postFailedBuildStatus(target, prId, commitHash, errorMessage);
      return { isValid: false, errorMessage, failureKind: 'internal-error' };
    }
  }
  
  private async postSuccessfulBuildStatus(
    target: BuildStatusTarget,
    prId: number,
    commitHash: string,
    description: string
  ): Promise<void> {
    await this.postBuildStatus(target, commitHash, 'success', description, {
      NAME: PR_VALIDATION_CONFIG.BUILD_STATUS.NAME(prId),
      KEY: PR_VALIDATION_CONFIG.BUILD_STATUS.KEY(prId),
    });
  }

  private async postFailedBuildStatus(
    target: BuildStatusTarget,
    prId: number,
    commitHash: string,
    description: string
  ): Promise<void> {
    await this.postBuildStatus(target, commitHash, 'failure', description, {
      NAME: PR_VALIDATION_CONFIG.BUILD_STATUS.NAME(prId),
      KEY: PR_VALIDATION_CONFIG.BUILD_STATUS.KEY(prId),
    });
  }

  /**
   * CAC is the only source; there is no env layer. Any CAC problem leaves the
   * check off rather than guessing.
   */
  private async resolveSpecCheckConfig(
    target: BuildStatusTarget,
    workspaceId: string
  ): Promise<{ enabled: boolean; configured: boolean; sections: string[] }> {
    // `configured` distinguishes a workspace that switched the check off from one
    // that never set the key: only the former can have a status left to clear.
    const fallback = {
      enabled: false,
      configured: false,
      sections: [...REQUIRED_SPEC_SECTIONS],
    };

    if (!superpositionClient.isReady()) {
      logger.debug('[PR-Validation] Superposition not ready, spec check stays off');
      return fallback;
    }

    try {
      const context = {
        workspaceId,
        provider: target.provider,
        ...(target.provider === VCSProviderType.GITHUB
          ? { owner: target.owner, repo: target.repo }
          : {}),
      };

      // One read for both keys: a per-flag lookup is a full config fetch.
      const details = await withTimeout(
        superpositionClient.resolveAllConfigDetails(context),
        {} as ResolvedConfigDetails,
        'spec-check config',
      );

      // The provider returns a flat map, the repo's type says wrapped. Both other
      // consumers unwrap defensively (agents/config.ts, cacConfigService); assuming
      // either shape makes the check silently never activate.
      const unwrap = (key: string): unknown => {
        const entry: unknown = details[key];
        return entry && typeof entry === 'object' && 'value' in entry
          ? (entry as { value: unknown }).value
          : entry;
      };

      const enabledValue = unwrap(PR_VALIDATION_CONFIG.SPEC_FLAGS.ENABLED);
      const configured = enabledValue !== undefined && enabledValue !== null;
      const enabled = typeof enabledValue === 'boolean' ? enabledValue : fallback.enabled;
      if (!enabled) return { enabled: false, configured, sections: fallback.sections };

      const sectionsValue = unwrap(PR_VALIDATION_CONFIG.SPEC_FLAGS.REQUIRED_SECTIONS);
      const rawSections =
        typeof sectionsValue === 'string' ? sectionsValue : fallback.sections.join(',');

      const sections = filterEnforceableSections(
        rawSections.split(',').map(section => section.trim()).filter(Boolean),
      );

      if (!sections.length) {
        logger.warn(
          `[PR-Validation] ${PR_VALIDATION_CONFIG.SPEC_FLAGS.REQUIRED_SECTIONS} has no ` +
            `enforceable section, using defaults: ${sanitizeForLog(rawSections)}`
        );
        return { enabled, configured, sections: fallback.sections };
      }

      return { enabled, configured, sections };
    } catch (error) {
      logger.warn('[PR-Validation] Superposition lookup failed, spec check stays off:', error);
      return fallback;
    }
  }

  /**
   * Workspace flags for the QA-assignee merge gate. Mirrors
   * resolveSpecCheckConfig: CAC is the only source, and any lookup problem
   * leaves the gate OFF rather than guessing (and blocking merges on bad data).
   */
  private async resolveQaAssigneeCheckConfig(
    target: BuildStatusTarget,
    workspaceId: string
  ): Promise<{ enabled: boolean; fieldName: string }> {
    const fallback = {
      enabled: false,
      fieldName: PR_VALIDATION_CONFIG.QA_ASSIGNEE.DEFAULT_FIELD_NAME,
    };

    if (!superpositionClient.isReady()) {
      logger.debug('[PR-Validation] Superposition not ready, QA-assignee check stays off');
      return fallback;
    }

    try {
      const context = {
        workspaceId,
        provider: target.provider,
        ...(target.provider === VCSProviderType.GITHUB
          ? { owner: target.owner, repo: target.repo }
          : {}),
      };

      const details = await withTimeout(
        superpositionClient.resolveAllConfigDetails(context),
        {} as ResolvedConfigDetails,
        'qa-assignee config'
      );

      // Flat map vs wrapped values: unwrap defensively like resolveSpecCheckConfig.
      const unwrap = (key: string): unknown => {
        const entry: unknown = details[key];
        return entry && typeof entry === 'object' && 'value' in entry
          ? (entry as { value: unknown }).value
          : entry;
      };

      const enabledValue = unwrap(PR_VALIDATION_CONFIG.QA_ASSIGNEE.ENABLED_FLAG);
      const enabled = typeof enabledValue === 'boolean' ? enabledValue : fallback.enabled;
      if (!enabled) return { enabled, fieldName: fallback.fieldName };

      const fieldNameValue = unwrap(PR_VALIDATION_CONFIG.QA_ASSIGNEE.FIELD_NAME_FLAG);
      const fieldName =
        typeof fieldNameValue === 'string' && fieldNameValue.trim()
          ? fieldNameValue.trim()
          : fallback.fieldName;

      return { enabled, fieldName };
    } catch (error) {
      logger.warn(
        '[PR-Validation] Superposition lookup failed, QA-assignee check stays off:',
        error
      );
      return fallback;
    }
  }

  /** A stored form value counts as filled when either shape carries content. */
  private isFilledFormValue(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed !== '' && trimmed !== '[]' && trimmed !== '{}' && trimmed !== 'null';
    }
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value as object).length > 0;
    return true;
  }

  /**
   * Whether the board-ticket form field `fieldName` is filled on a ticket.
   * Returns null when the value cannot be determined (no form mapped to the
   * board, no such field, or a read error) so the caller can fail open instead
   * of blocking a merge on unverifiable data.
   */
  private async isTicketFieldFilled(
    ticketId: string,
    boardId: string,
    fieldName: string
  ): Promise<boolean | null> {
    try {
      const formId = await resolveBoardTicketFormId(db, boardId);
      if (!formId) {
        logger.warn(
          `[PR-Validation] No ticket form mapped to board ${boardId}, cannot verify "${fieldName}"`
        );
        return null;
      }
      const definitions = await resolveFormFieldDefinitionsForForm(db, formId);
      const wanted = fieldName.trim().toLowerCase();
      const field = definitions.find(
        definition => definition.fieldName.trim().toLowerCase() === wanted
      );
      if (!field) {
        logger.warn(`[PR-Validation] No "${fieldName}" field on form ${formId}, cannot verify`);
        return null;
      }
      // No contextId filter: a value written under any context on this ticket
      // counts for the gate; the latest version row wins.
      const latestValues = await db.formEntityValues.findMany({
        where: {
          entityType: FormEntityType.TICKET,
          entityId: ticketId,
          fieldId: field.id,
        },
        orderBy: { version: 'desc' },
        take: 1,
      });
      const latest = latestValues[0];
      if (!latest) return false;
      return (
        this.isFilledFormValue(latest.actualFieldValue) ||
        this.isFilledFormValue(latest.fieldValue)
      );
    } catch (error) {
      logger.error(
        `[PR-Validation] Failed reading "${fieldName}" for ticket ${ticketId}:`,
        error
      );
      return null;
    }
  }

  private async hasSpecStatus(
    target: BuildStatusTarget,
    commitHash: string,
    prId: number
  ): Promise<boolean> {
    if (target.provider !== VCSProviderType.GITHUB) return false;
    return githubManager.hasCommitStatus(
      target.owner,
      target.repo,
      commitHash,
      PR_VALIDATION_CONFIG.SPEC_BUILD_STATUS.NAME(prId),
    );
  }

  /**
   * Report whether the linked ticket carries a complete spec, under its own
   * status so a spec failure is distinguishable from a ticket failure.
   */
  private async postSpecBuildStatus(
    target: BuildStatusTarget,
    commitHash: string,
    prId: number,
    workspaceId: string,
    result: ValidationResult
  ): Promise<void> {
    // GitHub only. A Bitbucket build status can feed merge gates directly, while
    // a GitHub status is inert until added to a ruleset, so this check is not
    // posted there at all - which also means it can leave nothing stale behind.
    if (target.provider !== VCSProviderType.GITHUB) return;

    const { ticketDescription, xyneId } = result;
    const resolvable = ticketDescription !== undefined && xyneId !== undefined;
    const { enabled, configured, sections } = await this.resolveSpecCheckConfig(
      target,
      workspaceId,
    );
    const specStatus = { NAME: PR_VALIDATION_CONFIG.SPEC_BUILD_STATUS.NAME(prId) };

    // Clear a verdict left from when the check was on; stay silent on commits
    // that never had one.
    if (!enabled) {
      if (configured && (await this.hasSpecStatus(target, commitHash, prId))) {
        await this.postBuildStatus(
          target,
          commitHash,
          'success',
          PR_VALIDATION_CONFIG.SPEC_MESSAGES.DISABLED,
          specStatus,
        );
      }
      return;
    }

    // A non-verdict passes: the spec was never judged, so it must not hold up a
    // merge, and an unfinalized state would linger on the commit.
    if (!resolvable) {
      const reason =
        result.failureKind === 'internal-error'
          ? PR_VALIDATION_CONFIG.SPEC_MESSAGES.NOT_EVALUATED
          : PR_VALIDATION_CONFIG.SPEC_MESSAGES.NOT_CHECKED;
      await this.postBuildStatus(target, commitHash, 'success', reason, specStatus);
      return;
    }

    const spec = validateSpecSections(ticketDescription, sections);

    if (spec.isValid) {
      await this.postBuildStatus(
        target,
        commitHash,
        'success',
        PR_VALIDATION_CONFIG.SPEC_MESSAGES.VALIDATION_PASSED,
        specStatus,
      );
      return;
    }

    const allMissing = spec.missing.length === spec.requiredCount && !spec.hasSpecHeading;
    const errorMessage = allMissing
      ? PR_VALIDATION_CONFIG.SPEC_MESSAGES.MISSING(xyneId)
      : PR_VALIDATION_CONFIG.SPEC_MESSAGES.INCOMPLETE(
          xyneId,
          formatMissingSections(spec.missing),
        );
    logger.info(
      `[PR-Validation] Spec check failed for ${sanitizeForLog(xyneId)}: ` +
        `missing ${sanitizeForLog(spec.missing.join(', '))}`
    );
    await this.postBuildStatus(target, commitHash, 'failure', errorMessage, specStatus);
  }

  /**
   * Report the validation outcome on the commit so it shows as a check on the PR.
   * Never throws: a status-API failure must not change the validation verdict.
   */
  private async postBuildStatus(
    target: BuildStatusTarget,
    commitHash: string,
    state: BuildStatusState,
    description: string,
    // Required: a default here would silently post under the wrong context. KEY is
    // optional because a GitHub-only status has no Bitbucket build-status key.
    buildStatus: { NAME: string; KEY?: string }
  ): Promise<void> {
    try {
      // No target_url on GitHub: the repo is public, so a status link would put
      // the internal frontend host in front of anyone who can see the PR.
      if (target.provider === VCSProviderType.GITHUB) {
        await githubManager.postCommitStatus(
          target.owner,
          target.repo,
          commitHash,
          state,
          buildStatus.NAME,
          description,
        );
        return;
      }
      if (!buildStatus.KEY) {
        logger.error(
          `[PR-Validation] ${buildStatus.NAME} has no Bitbucket key, not posted`
        );
        return;
      }
      await this.bitbucketManager.postBuildStatus(
        commitHash,
        BITBUCKET_BUILD_STATE[state],
        buildStatus.KEY,
        buildStatus.NAME,
        process.env.FRONTEND_URL || '',
        description,
      );
    } catch (error) {
      logger.error(
        `[PR-Validation] Failed to post ${state} ${buildStatus.NAME} status (${target.provider}):`,
        error
      );
    }
  }
}

// Export singleton instance
export const pullRequestValidationService = new PullRequestValidationService();
