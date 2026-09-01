import { TicketRepository } from '@/database/repositories/ticketRepository';
import { PRMetricsRepository } from '@/database/repositories/pullRequestsRepository';
import { BitbucketManager } from '@/bitbucket/apis';
import { githubManager, sanitizeForLog } from '@/git-providers/github/apis';
import {
  superpositionClient,
  type ResolvedConfigDetails,
} from '@/services/superpositionClient';
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
  SPEC_MESSAGES: {
    MISSING: (ticketId: string) => `No specification on ${ticketId} - run /spec on the ticket`,
    INCOMPLETE: (ticketId: string, missing: string) => `${ticketId} spec missing: ${missing}`,
    NOT_CHECKED: 'Ticket not resolved - spec not checked',
    NOT_EVALUATED: 'Spec not evaluated - validation error',
    DISABLED: 'Spec check disabled',
    VALIDATION_PASSED: 'Specification complete',
  },
  BUILD_STATUS: {
    // Bitbucket build-status key (dedupes statuses per commit).
    KEY: 'xyne-ticket-check',
    // Display name: Bitbucket build-status `name`, GitHub commit-status `context`.
    NAME: 'Ticket Validation',
  },
  // No Bitbucket key: this check is GitHub only, and GitHub identifies a status
  // by its context alone.
  SPEC_BUILD_STATUS: {
    NAME: 'Spec Validation',
  },
  REQUIRED_SPEC_SECTIONS: ['Problem statement', 'Solutioning', 'Test cases'],
  SPEC_FLAGS: {
    ENABLED: 'pr_spec_check_enabled',
    REQUIRED_SECTIONS: 'pr_spec_required_sections',
  },
} as const;

const SPEC_SECTION = 'specification';

export interface SpecValidationResult {
  isValid: boolean;
  missing: string[];
  hasSpecHeading: boolean;
  /** Sections actually enforced, after the wrapper name is dropped. */
  requiredCount: number;
}

interface SpecMarker {
  name: string;
  line: number;
  hasInlineBody: boolean;
}

const normalizeHeading = (text: string): string =>
  text
    .replace(/^>+\s*/, '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/[*_`]/g, '')
    .replace(/[:\-–—\s]+$/, '')
    .trim()
    .toLowerCase();

const LIST_ITEM = /^([-*+]|\d+[.)])\s+/;
const INDENTED_CODE = /^(?: {4,}|\t)/;
const FENCE = /^(`{3,}|~{3,})(.*)$/;

const matchMarker = (
  line: string,
  sectionNames: Set<string>
): { name: string; hasInlineBody: boolean } | null => {
  if (LIST_ITEM.test(line.replace(/^>+\s*/, ''))) return null;

  const bare = line.replace(/^>+\s*/, '');
  const text = bare.replace(/^#{1,6}\s*/, '');
  const whole = normalizeHeading(text);
  if (sectionNames.has(whole)) return { name: whole, hasInlineBody: false };

  // Inline "Name: body" needs heading or bold markup. Bare prose starting with a
  // section name is ordinary text, and consuming it truncates the real section.
  if (!/^(#{1,6}\s|[*_])/.test(bare)) return null;

  const separator = text.search(/[:–—]|\s-\s/);
  if (separator > 0) {
    const name = normalizeHeading(text.slice(0, separator));
    const body = text.slice(separator + 1).replace(/[*_`]/g, '').trim();
    if (sectionNames.has(name) && body.length > 0) return { name, hasInlineBody: true };
  }
  return null;
};

const parseMarkers = (lines: string[], sectionNames: Set<string>): SpecMarker[] => {
  const markers: SpecMarker[] = [];
  let fence: { char: string; length: number } | null = null;

  lines.forEach((raw, index) => {
    // An indented line can neither open nor close a fence.
    if (INDENTED_CODE.test(raw)) return;

    const line = raw.trim().replace(/^>+\s*/, '');
    const fenceMatch = line.match(FENCE);
    if (fenceMatch) {
      const char = fenceMatch[1]![0]!;
      const length = fenceMatch[1]!.length;
      const info = fenceMatch[2]!.trim();
      if (!fence) fence = { char, length };
      else if (char === fence.char && length >= fence.length && info === '') fence = null;
      return;
    }
    if (fence) return;

    const marker = matchMarker(line, sectionNames);
    if (marker) markers.push({ ...marker, line: index });
  });
  return markers;
};

/**
 * Each required section must be named, with text under it. `sections` is passed
 * in so a /spec rename is a config change rather than a code change.
 */
export function validateSpecSections(
  description: string | null | undefined,
  sections: readonly string[] = PR_VALIDATION_CONFIG.REQUIRED_SPEC_SECTIONS
): SpecValidationResult {
  // The wrapper name can never be satisfied as a section: narrowing removes it.
  const required = [...sections].filter(section => normalizeHeading(section) !== SPEC_SECTION);
  // Nothing enforceable was asked for, so there is nothing to fail on.
  if (!required.length) {
    return { isValid: true, missing: [], hasSpecHeading: false, requiredCount: 0 };
  }
  if (!description || !description.trim()) {
    return { isValid: false, missing: required, hasSpecHeading: false, requiredCount: required.length };
  }

  const sectionNames = new Set<string>([
    SPEC_SECTION,
    ...required.map(section => normalizeHeading(section)),
  ]);
  const lines = description.split(/\r?\n/);
  const markers = parseMarkers(lines, sectionNames);
  const hasSpecHeading = markers.some(marker => marker.name === SPEC_SECTION);

  // A wrapper narrows scope only when every section follows it: one written
  // mid-description would otherwise discard the sections above it.
  const firstSection = markers.findIndex(marker => marker.name !== SPEC_SECTION);
  const wrapper = markers.findIndex(marker => marker.name === SPEC_SECTION);
  const scope =
    wrapper !== -1 && (firstSection === -1 || wrapper < firstSection)
      ? markers.slice(wrapper + 1)
      : markers;

  const hasBody = (index: number): boolean => {
    if (scope[index]!.hasInlineBody) return true;
    // Content runs to the next section name, or to the end of the description.
    const bodyStart = scope[index]!.line + 1;
    const bodyEnd = index + 1 < scope.length ? scope[index + 1]!.line : lines.length;
    return lines.slice(bodyStart, bodyEnd).some(line => line.trim().length > 0);
  };

  // Any occurrence with content satisfies the section: a heading duplicated by a
  // stray edit must not fail a spec whose content is under the second copy.
  const missing = required.filter(section => {
    const target = normalizeHeading(section);
    const occurrences = scope
      .map((marker, index) => (marker.name === target ? index : -1))
      .filter(index => index !== -1);
    return !occurrences.some(hasBody);
  });

  return {
    isValid: missing.length === 0,
    missing,
    hasSpecHeading,
    requiredCount: required.length,
  };
}

const formatMissingSections = (missing: string[]): string => {
  const shown = missing.slice(0, 3).join(', ');
  return missing.length > 3 ? `${shown} +${missing.length - 3} more` : shown;
};

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

// Superposition's own timeout is 30s; this sits on the webhook response path,
// which GitHub gives 10s.
const SPEC_CONFIG_TIMEOUT_MS = 2500;

const withTimeout = async <T>(work: Promise<T>, fallback: T, label: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>(resolve => {
        timer = setTimeout(() => {
          logger.warn(`[PR-Validation] ${label} timed out after ${SPEC_CONFIG_TIMEOUT_MS}ms`);
          resolve(fallback);
        }, SPEC_CONFIG_TIMEOUT_MS);
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
    const { commitHash, workspaceId } = params;
    const result = await this.runTicketValidation(params, target);
    // Awaited so two events for the same commit cannot post out of order; the
    // config read inside is time-bounded. Called here so no early return in
    // runTicketValidation skips it.
    await this.postSpecBuildStatus(target, commitHash, workspaceId, result);
    return result;
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
        await this.postFailedBuildStatus(target, commitHash, errorMessage);
        return { isValid: false, errorMessage };
      }

      const ticketId = `${ticketIdMatch[1]}-${ticketIdMatch[2]}`;
      logger.info(`[PR-Validation] Validating PR ${prId} against ticket ${ticketId}`);

      const ticket = await this.ticketRepository.getTicketByXyneId(ticketId, workspaceId);


      if (!ticket) {
        const errorMessage = PR_VALIDATION_CONFIG.ERROR_MESSAGES.TICKET_NOT_FOUND(ticketId);
        await this.postFailedBuildStatus(target, commitHash, errorMessage);
        return { isValid: false, errorMessage, ticketId, xyneId: ticketId };
      }

      if (ticket.status === 'RESOLVED') {
        const errorMessage = PR_VALIDATION_CONFIG.ERROR_MESSAGES.TICKET_ALREADY_RESOLVED(ticketId);
        await this.postFailedBuildStatus(target, commitHash, errorMessage);
        return {
          isValid: false,
          errorMessage,
          ticketId,
          xyneId: ticketId,
          ticketDescription: ticket.description,
        };
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
          await this.postSuccessfulBuildStatus(target, commitHash, successMessage);
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
        await this.postFailedBuildStatus(target, commitHash, errorMessage);
        return {
          isValid: false,
          errorMessage,
          ticketId,
          xyneId: ticketId,
          ticketDescription: ticket.description,
        };
      }

      const successMessage = PR_VALIDATION_CONFIG.ERROR_MESSAGES.VALIDATION_PASSED;
      await this.postSuccessfulBuildStatus(target, commitHash, successMessage);
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
      await this.postFailedBuildStatus(target, commitHash, errorMessage);
      return { isValid: false, errorMessage, failureKind: 'internal-error' };
    }
  }
  
  private async postSuccessfulBuildStatus(
    target: BuildStatusTarget,
    commitHash: string,
    description: string
  ): Promise<void> {
    await this.postBuildStatus(
      target,
      commitHash,
      'success',
      description,
      PR_VALIDATION_CONFIG.BUILD_STATUS,
    );
  }

  private async postFailedBuildStatus(
    target: BuildStatusTarget,
    commitHash: string,
    description: string
  ): Promise<void> {
    await this.postBuildStatus(
      target,
      commitHash,
      'failure',
      description,
      PR_VALIDATION_CONFIG.BUILD_STATUS,
    );
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
      sections: [...PR_VALIDATION_CONFIG.REQUIRED_SPEC_SECTIONS],
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

      const sections = rawSections
        .split(',')
        .map(section => section.trim())
        .filter(Boolean)
        .filter(section => normalizeHeading(section) !== SPEC_SECTION);

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

  private async hasSpecStatus(
    target: BuildStatusTarget,
    commitHash: string
  ): Promise<boolean> {
    if (target.provider !== VCSProviderType.GITHUB) return false;
    return githubManager.hasCommitStatus(
      target.owner,
      target.repo,
      commitHash,
      PR_VALIDATION_CONFIG.SPEC_BUILD_STATUS.NAME,
    );
  }

  /**
   * Report whether the linked ticket carries a complete spec, under its own
   * status so a spec failure is distinguishable from a ticket failure.
   */
  private async postSpecBuildStatus(
    target: BuildStatusTarget,
    commitHash: string,
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
    const specStatus = PR_VALIDATION_CONFIG.SPEC_BUILD_STATUS;

    // Clear a verdict left from when the check was on; stay silent on commits
    // that never had one.
    if (!enabled) {
      if (configured && (await this.hasSpecStatus(target, commitHash))) {
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
      const targetUrl = process.env.FRONTEND_URL || '';
      if (target.provider === VCSProviderType.GITHUB) {
        await githubManager.postCommitStatus(
          target.owner,
          target.repo,
          commitHash,
          state,
          buildStatus.NAME,
          description,
          targetUrl || undefined,
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
        targetUrl,
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
