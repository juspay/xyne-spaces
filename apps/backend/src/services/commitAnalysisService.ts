import { BitbucketService } from './bitbucketService';
import { VcsClient } from '../types/vcs';
import { TicketRepository } from '@/database/repositories/ticketRepository';
import { DatabaseClient } from '@/database/client';
import { ApplicationRepository } from '@/database/repositories/applicationRepository';
import { logger } from '@/utils/logger';
import { PullRequestInfo, DiffstatSummary, ChangeEntry } from '@/types/bitbucket';
import { FormContextType, FormEntityType, BaseTicketType, BoardType, ChannelVisibility, TicketPriority, TicketStatusV2 } from '@xyne/shared';
import { Application, } from '@prisma/client';
import { XyneRelease } from './release/xyne/xyneRelease';
import { ReleaseRepository } from '@/database/repositories/releaseRepository';
import { XyneChangeType } from './release/xyne/xyneReleaseForm';
import {
  ChangeDetector,
  FileChangeType,
  mapBitbucketChangeType,
  DiffParser,
  ReleaseEventContext,
} from './release/core';
export type AnalyzeCommitsRequest =
  | {
    commitIds: string[];
    projectKey: string;
    repositorySlug: string;
    workspaceId: string;
    // Local Project.code used to build the ticket-id regex (e.g. 'TSP'). When
    // omitted, falls back to 'XYNE' for legacy callers that haven't been
    // updated yet.
    ticketPrefix?: string;
    branch?: string;
    retryMissingPr?: boolean;
  }
  | {
    deployedCommitId: string;
    newCommitId: string;
    projectKey: string;
    repositorySlug: string;
    workspaceId: string;
    ticketPrefix?: string;
    branch?: string;
    retryMissingPr?: boolean;
  };

export interface CommitAnalysisResult {
  commitId: string;
  pullRequest: PullRequestInfo | null;
  ticket: TicketInfo | null;
  foldersChanged: string[];
  filePaths: string[];
  fileChanges: Array<{ path: string; changeType: FileChangeType }>;
  diffstat: DiffstatSummary | null;
  environment: string[] | null;
  migration: string[] | null;
  error: string | null;
}

export interface TicketInfo {
  id: string;
  xyneId: string;
  title: string;
  status: string;
  priority: string;
  assignedTo: string | null;
  ticketType: string | null;
}

export interface PullRequestDiffFile {
  oldPath?: string | null;
  newPath?: string | null;
  path?: string | null;
  filename?: string | null;
  type?: string | null;
  hunks?: Array<{ content?: string | null }>;
}

/** PR author shape (from BitbucketService) used to back local autostub users. */
type StubAuthor = { id?: string | number; displayName?: string; emailAddress?: string };

// Bounds for retrying an eventually-consistent PR lookup (see analyzeEachCommit).
const PR_LOOKUP_MAX_RETRIES = 3;
const PR_LOOKUP_RETRY_DELAY_MS = 2000;

// Count distinct migration files (one row per file×commit is stored, so a file
// touched across commits — e.g. schema.prisma — must collapse to one).
export function countDistinctMigrationFiles(
  migrationLinks: Array<{ filePath: string; diffUrl: string }> | undefined | null
): number {
  return new Set((migrationLinks ?? []).map(link => link.filePath)).size;
}

export class CommitAnalysisService {
  // Structurally typed so a BitbucketService or GitHubService can be passed —
  // the controller picks based on board.vcsProvider.
  private bitbucketService: VcsClient;
  private ticketRepository: TicketRepository | null = null;
  private applicationRepository: ApplicationRepository | null = null;
  private xyneRelease: XyneRelease | null = null;
  private releaseRepository: ReleaseRepository | null = null;

  constructor(vcsClient: VcsClient | BitbucketService) {
    this.bitbucketService = vcsClient;
    this.initialize();
  }

  /**
   * Initialize service dependencies
   */
  private initialize(): void {
    try {
      if (
        this.applicationRepository &&
        this.xyneRelease &&
        this.releaseRepository
      ) {
        return;
      }

      this.applicationRepository = new ApplicationRepository();
      // TODO: we should have a factory/service to generate the release change requests
      this.xyneRelease = new XyneRelease();
      this.releaseRepository = new ReleaseRepository();
      logger.info('[CommitAnalysisService] Successfully initialized all repositories');
    } catch (error) {
      logger.error('[CommitAnalysisService] Failed to initialize repositories:', error);
    }

  }

  private get tickets(): TicketRepository {
    this.ticketRepository ??= new TicketRepository();
    return this.ticketRepository;
  }



  private extractTicketId(prTitle: string, prefix: string): string | null {
    // Build the regex dynamically from the project's code (e.g. TSP, XYNE).
    // Escape any regex metachars defensively even though codes are usually
    // uppercase alphanumerics.
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const start = new RegExp(`^(${escaped}-\\d+)`);
    // \b prevents matching the code inside a larger token (e.g. prefix "EX"
    // must not match "EX-12" embedded in "FLEX-12").
    const anywhere = new RegExp(`\\b${escaped}-\\d+`);

    const match = prTitle.match(start);
    if (match) {
      return match[1];
    }

    const anywhereMatch = prTitle.match(anywhere);
    if (anywhereMatch) {
      logger.debug(
        `Ticket ID found in PR title but not at start: "${prTitle}". Using: ${anywhereMatch[0]}`
      );
      return anywhereMatch[0];
    }

    return null;
  }

  private async fetchTicketByXyneId(
    xyneId: string,
    workspaceId: string,
    ticketPrefix: string,
    prTitle?: string,
    prAuthor?: StubAuthor,
  ): Promise<TicketInfo | null> {
    try {
      const ticket = await this.tickets.getTicketByXyneId(xyneId, workspaceId);

      if (ticket) {
        return {
          id: ticket.id,
          xyneId: ticket.xyneId,
          title: ticket.title,
          status: ticket.statusV2,
          priority: ticket.priority,
          assignedTo: ticket.assignedTo,
          ticketType: ticket.ticketType ?? null,
        };
      }

      // Dev-only convenience: prod dev-tickets aren't in a local DB, so PR
      // titles reference XYNE-NNNN ids that don't exist locally → ART stays
      // empty. When RELEASE_AUTOSTUB_MISSING_TICKETS=1 (and not in production),
      // synthesize a minimal stub so the release flow can finish populating
      // ART rows. Guarded twice so an accidental env var in prod still no-ops.
      // TODO: remove this branch (or harden into an admin tool) before this
      // ships — local dev convenience only.
      if (
        process.env.NODE_ENV !== 'production' &&
        process.env.RELEASE_AUTOSTUB_MISSING_TICKETS === '1'
      ) {
        const stub = await this.autoStubMissingTicket(xyneId, ticketPrefix, workspaceId, prTitle, prAuthor);
        if (stub) {
          logger.info(`[AutoStub] Created stub ticket for ${xyneId} (dev only)`);
          return stub;
        }
      }

      logger.debug(`Ticket ${xyneId} not found in database`);
      return null;
    } catch (error) {
      logger.error(`Error fetching ticket ${xyneId} from database:`, error);
      return null;
    }
  }

  /**
   * Dev-only stub creator. Looks up the project by `code = ticketPrefix`,
   * picks any non-RELEASE board on it as the home for the stub, and inserts
   * a minimal Ticket row so downstream ART writes can resolve. Returns null
   * if the project / board / a workspace user can't be resolved (gives up
   * silently — local convenience, not a hard guarantee).
   */
  private async autoStubMissingTicket(
    xyneId: string,
    ticketPrefix: string,
    workspaceId: string,
    prTitle?: string,
    author?: StubAuthor,
  ): Promise<TicketInfo | null> {
    try {
      const db = DatabaseClient.getInstance();
      const project = await db.project.findFirst({
        where: { code: ticketPrefix, workspaceId },
        select: { id: true, workspaceId: true },
      });
      if (!project) {
        logger.warn(`[AutoStub] No project found with code=${ticketPrefix} in workspace=${workspaceId}`);
        return null;
      }
      const board = await db.board.findFirst({
        where: { projectId: project.id, boardType: { not: BoardType.RELEASE } },
        select: { id: true },
      });
      if (!board) {
        logger.warn(`[AutoStub] No non-RELEASE board on project ${project.id}`);
        return null;
      }
      // Use all workspace users so any logged-in user can own/edit the stub.
      // Also grab orgMemberId so we can mint a dummy author user (User.orgMemberId
      // is a required FK — dummy users borrow an existing member's id locally).
      const allUsers = await db.user.findMany({
        where: { workspaceId },
        select: { id: true, orgMemberId: true },
      });
      if (allUsers.length === 0) {
        logger.warn(`[AutoStub] No users in workspace ${workspaceId}`);
        return null;
      }
      const user = allUsers[0];

      // Mint (or reuse) a dummy user representing the PR author and assign the
      // stub to them, so the Dev Owner column shows the real author and the
      // ticket → user FK gets exercised end-to-end. Falls back to `user` if the
      // PR carried no usable author identity.
      const assigneeId =
        (await this.findOrCreateAuthorUser(author, workspaceId, user.orgMemberId)) ?? user.id;

      // Tickets ACL filters by channel/project participation. The channel
      // must belong to the stub's project so the ACL's
      // `channel → project → channels (PUBLIC, participant)` traversal resolves.
      // Prefer a PUBLIC channel on the project; fall back to any project channel.
      const channel =
        (await db.channel.findFirst({
          where: { projectId: project.id, visibility: ChannelVisibility.PUBLIC },
          select: { id: true },
        })) ??
        (await db.channel.findFirst({
          where: { projectId: project.id },
          select: { id: true },
        }));
      if (!channel) {
        logger.warn(`[AutoStub] No channel found on project ${project.id}`);
        return null;
      }

      // Find an existing Conversation in the project channel so the stub's
      // conversationId points to a real row — the TicketActivitiesACL
      // traverses ticket → conversation → channel → project to verify access.
      const conversation = await db.conversation.findFirst({
        where: { channelId: channel.id },
        select: { conversationId: true },
      });

      const stub = await db.ticket.create({
        data: {
          xyneId,
          title: prTitle?.slice(0, 200) ?? `[stub] ${xyneId}`,
          description: '[Auto-stub created by release-manager dev mode]',
          createdBy: user.id,
          updatedBy: user.id,
          assignedTo: assigneeId,
          projectId: project.id,
          workspaceId,
          boardId: board.id,
          channelId: channel.id,
          // conversationId must point to a real Conversation row (not a channel id)
          // so the TicketActivitiesACL's ticket→conversation→channel traversal resolves.
          // Re-use an existing conversation in the project channel if available.
          conversationId: conversation?.conversationId ?? channel.id,
          statusV2: TicketStatusV2.TODO,
          priority: TicketPriority.LOW,
          stageName: 'BACKLOG',
          ticketType: BaseTicketType.Fix,
          lastEmailAt: new Date(),
        },
        select: { id: true, xyneId: true, title: true, statusV2: true, priority: true, assignedTo: true, ticketType: true },
      });

      // Add ALL workspace users as channel participants so any logged-in user
      // passes the Zero ACL's `canUpdate` / `canInsert` checks (both require
      // the caller to be a participant in a project channel).
      await Promise.all(
        allUsers.map(u =>
          db.channelParticipant.upsert({
            where: { channelId_userId: { channelId: channel.id, userId: u.id } },
            create: { channelId: channel.id, userId: u.id, workspaceId },
            update: {},
          }),
        ),
      );

      return {
        id: stub.id,
        xyneId: stub.xyneId,
        title: stub.title,
        status: stub.statusV2,
        priority: stub.priority,
        assignedTo: stub.assignedTo,
        ticketType: stub.ticketType ?? null,
      };
    } catch (error) {
      logger.error(`[AutoStub] Failed to create stub for ${xyneId}:`, error as Error);
      return null;
    }
  }

  /**
   * Dev-only: find or create a local user mirroring a PR author so stub dev
   * tickets get a realistic Dev Owner and the ticket → user FK is exercised.
   * Keyed by (email, workspaceId). `orgMemberId` is a required FK on User, so
   * dummy users borrow an existing workspace member's id (fine locally).
   * Returns the user id, or null if the author has no usable identity.
   */
  private async findOrCreateAuthorUser(
    author: StubAuthor | undefined,
    workspaceId: string,
    fallbackOrgMemberId: string,
  ): Promise<string | null> {
    if (!author) return null;
    const db = DatabaseClient.getInstance();

    const email =
      author.emailAddress?.trim() ||
      (author.id != null ? `autostub+${author.id}@local.dev` : null);
    if (!email) return null;

    const existing = await db.user.findFirst({
      where: { email, workspaceId },
      select: { id: true },
    });
    if (existing) return existing.id;

    const name = author.displayName?.trim() || email;
    const created = await db.user.create({
      data: {
        name,
        email,
        displayName: author.displayName?.trim() ?? null,
        providerUserId: `autostub:${author.id ?? email}`,
        workspaceId,
        orgMemberId: fallbackOrgMemberId,
      },
      select: { id: true },
    });
    logger.info(`[AutoStub] Created dummy author user ${created.id} (${email})`);
    return created.id;
  }

  private extractFolders(filePaths: string[]): string[] {
    const folders = new Set<string>();

    for (const path of filePaths) {
      const parts = path.split('/');
      if (parts.length > 1) {
        folders.add(parts[0]);
      }
    }

    return Array.from(folders).sort();
  }

  private computeDiffstatSummary(changeEntries: ChangeEntry[]): DiffstatSummary {
    return {
      filesChanged: changeEntries.length,
      linesAdded: 0,
      linesRemoved: 0,
    };
  }

  private extractFilePaths(changeEntries: ChangeEntry[]): string[] {
    return changeEntries
      .map((entry) => this.getChangeEntryPath(entry))
      .filter(Boolean) as string[];
  }

  private async analyzeEachCommit(
    commitId: string,
    projectKey: string,
    repositorySlug: string,
    workspaceId: string,
    ticketPrefix: string,
    branch?: string,
    retryMissingPr = false,
  ): Promise<CommitAnalysisResult> {
    const result: CommitAnalysisResult = {
      commitId,
      pullRequest: null,
      ticket: null,
      foldersChanged: [],
      filePaths: [],
      fileChanges: [],
      diffstat: null,
      environment: null,
      migration: null,
      error: null,
    };

    try {
      logger.debug(`Analyzing commit ${commitId}: Finding pull request...`);
      let pullRequest = await this.bitbucketService.getMergedPullRequest(
        projectKey,
        repositorySlug,
        commitId,
        branch
      );

      // GitHub's commit-to-PR API is eventually consistent; a hotfix sync fires right after merge, so retry before giving up.
      for (let attempt = 0; !pullRequest && retryMissingPr && attempt < PR_LOOKUP_MAX_RETRIES; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, PR_LOOKUP_RETRY_DELAY_MS));
        pullRequest = await this.bitbucketService.getMergedPullRequest(projectKey, repositorySlug, commitId, branch);
      }

      if (!pullRequest) {
        result.error = 'No merged pull request found for commit';
        logger.info(`Commit ${commitId}: No merged PR found`);
        return result;
      }

      result.pullRequest = pullRequest;
      logger.debug(`Commit ${commitId}: Found PR #${pullRequest.id} - "${pullRequest.title}"`);

      const ticketId = this.extractTicketId(pullRequest.title, ticketPrefix);

      if (!ticketId) {
        result.error = 'No ticket ID found in PR title';
        logger.info(`Commit ${commitId}: No ticket ID in PR title "${pullRequest.title}"`);
      } else {
        logger.debug(`Commit ${commitId}: Extracted ticket ID ${ticketId}`);

        const ticket = await this.fetchTicketByXyneId(ticketId, workspaceId, ticketPrefix, pullRequest.title, pullRequest.author);

        if (!ticket) {
          logger.info(`Commit ${commitId}: Ticket ${ticketId} not found in database`);
        } else {
          result.ticket = ticket;
          logger.debug(`Commit ${commitId}: Found ticket ${ticket.xyneId}`);
        }
      }

      const changeEntries = await this.bitbucketService.getCommitChanges(
        projectKey,
        repositorySlug,
        commitId
      );

      const diffstat = this.computeDiffstatSummary(changeEntries);
      result.diffstat = diffstat;

      const filePaths = this.extractFilePaths(changeEntries);
      result.filePaths = filePaths;

      result.fileChanges = changeEntries.map(entry => ({
        path: this.getChangeEntryPath(entry),
        changeType: mapBitbucketChangeType(entry.type)
      }));

      const foldersChanged = this.extractFolders(filePaths);
      result.foldersChanged = foldersChanged;

      logger.info(
        `Commit ${commitId}: Analysis complete. PR #${pullRequest.id}, Ticket: ${result.ticket?.xyneId || 'none'}, Folders: [${foldersChanged.join(', ')}], Files: ${diffstat.filesChanged}`
      );

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.error = errorMessage;

      logger.warn(`Commit ${commitId}: Analysis failed - ${errorMessage}`);

      return result;
    }
  }

  async analyzeCommits(request: AnalyzeCommitsRequest): Promise<CommitAnalysisResult[]> {
    const isRangeMode = 'deployedCommitId' in request && 'newCommitId' in request;
    const projectKey = request.projectKey;
    const repositorySlug = request.repositorySlug;
    const workspaceId = request.workspaceId;
    // Fail fast: an empty workspaceId silently makes every ticket lookup
    // (getTicketByXyneId / autoStub project+user queries) match nothing or the
    // wrong workspace, producing zero ticket linkage instead of a clear error.
    if (!workspaceId) {
      throw new Error('workspaceId is required for commit analysis');
    }
    // Default to 'XYNE' to preserve the legacy hardcoded behavior for any
    // caller that hasn't been updated to pass `ticketPrefix`.
    const ticketPrefix = request.ticketPrefix ?? 'XYNE';

    let commitIds: string[];

    if (isRangeMode) {
      const { deployedCommitId, newCommitId, branch } = request;
      const startCommits = deployedCommitId.includes(',')
        ? deployedCommitId
          .split(',')
          .map((c) => c.trim())
          .filter((c) => c)
        : [deployedCommitId];

      logger.info(
        `Starting analysis of commits between ${startCommits.join(', ')} and ${newCommitId}${branch ? ` on branch ${branch}` : ''} in ${projectKey}/${repositorySlug}`
      );

      const allCommitsSet = new Set<string>();
      for (const startCommit of startCommits) {
        try {
          const commitsInRange = await this.bitbucketService.getCommitsBetween(
            projectKey,
            repositorySlug,
            startCommit,
            newCommitId,
            branch
          );
          commitsInRange.forEach((c) => allCommitsSet.add(c));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logger.error(
            `Failed to fetch commits between ${startCommit} and ${newCommitId}: ${errorMessage}`
          );
          throw error;
        }
      }

      commitIds = Array.from(allCommitsSet);
      if (commitIds.length === 0) {
        logger.warn(`No commits found between ${startCommits.join(', ')} and ${newCommitId}`);
        return [];
      }

      logger.info(
        `Discovered ${commitIds.length} unique commit(s) in range. Proceeding with analysis...`
      );
    } else {
      commitIds = request.commitIds;
      logger.info(
        `Starting analysis of ${commitIds.length} specific commit(s) in ${projectKey}/${repositorySlug}`
      );
    }

    let results: CommitAnalysisResult[];
    try {
      // Bounded concurrency (was an unbounded Promise.all): each commit's analysis
      // fans out further API calls (changes pagination + PR lookup), so analyzing
      // every commit at once bursts hundreds of requests and trips the WAF in
      // front of Bitbucket (403 "Rate limit ... in WAF"). Batches of 4 keep the
      // request rate inside the WAF budget while preserving result order.
      const CONCURRENCY = 4;
      results = [];
      for (let i = 0; i < commitIds.length; i += CONCURRENCY) {
        const batch = await Promise.all(
          commitIds
            .slice(i, i + CONCURRENCY)
            .map((commitId) =>
              this.analyzeEachCommit(commitId, projectKey, repositorySlug, workspaceId, ticketPrefix, request.branch, request.retryMissingPr ?? false)
            )
        );
        results.push(...batch);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to analyze commits: ${errorMessage}`);
      throw error;
    }

    const successCount = results.filter((r) => r.pullRequest !== null).length;
    const ticketCount = results.filter((r) => r.ticket !== null).length;

    logger.info(
      `Commit analysis complete: ${successCount}/${commitIds.length} commits have PRs, ${ticketCount}/${commitIds.length} have tickets`
    );

    return results;
  }

  async detectAffectedApplications(
    mainReleaseBoardId: string,
    filePaths: string[]
  ): Promise<
    (Application & { matchedFiles: string[] })[]
  > {
    logger.info(`Detecting affected applications for main release board ${mainReleaseBoardId}`, {
      fileCount: filePaths.length,
    });

    const applications =
      await this.applicationRepository!.findByMainReleaseBoardId(mainReleaseBoardId);

    if (applications.length === 0) {
      logger.info(`No applications found for main release board ${mainReleaseBoardId}`);
      return [];
    }

    const affectedAppsMap = new Map();

    for (const filePath of filePaths) {
      for (const application of applications) {
        if (this.matchesApplication(filePath, application.regex)) {
          const appId = application.id;
          if (!affectedAppsMap.has(appId)) {
            affectedAppsMap.set(appId, {
              ...application,
              matchedFiles: [],
            });
          }

          affectedAppsMap.get(appId)!.matchedFiles.push(filePath);
        }
      }
    }

    const affectedApplications = Array.from(affectedAppsMap.values());

    logger.info(`Detected ${affectedApplications.length} affected applications`, {
      affectedApps: affectedApplications.map((app) => app.name),
    });

    return affectedApplications;
  }

  private matchesApplication(filePath: string, applicationRegex: string): boolean {
    try {
      const regex = new RegExp(applicationRegex);
      return regex.test(filePath);
    } catch (error) {
      logger.warn(`Invalid regex pattern for application: ${applicationRegex}`, error);
      return false;
    }
  }

  /**
   * Diagnostic-only sibling to {@link detectAffectedApplications}. Returns one
   * entry per configured application — INCLUDING those whose regex matched
   * zero files — so the release summary can show "0/2 apps matched" with
   * per-app counts. This is what lets the user tell "no env/migrations
   * changed" apart from "my regex was broken".
   */
  async getApplicationMatchSummary(
    mainReleaseBoardId: string,
    filePaths: string[],
  ): Promise<Array<{ name: string; regex: string; matchCount: number; regexValid: boolean }>> {
    const applications =
      await this.applicationRepository!.findByMainReleaseBoardId(mainReleaseBoardId);
    return applications.map((app) => {
      let re: RegExp | null = null;
      try {
        re = new RegExp(app.regex);
      } catch {
        re = null;
      }
      const matchCount = re ? filePaths.reduce((n, p) => (re!.test(p) ? n + 1 : n), 0) : 0;
      return {
        name: app.name,
        regex: app.regex,
        matchCount,
        regexValid: re !== null,
      };
    });
  }

  async saveReleaseChangesWithDiffs(
    projectKey: string,
    repositorySlug: string,
    commitId: string,
    filePaths: string[],
    fileChanges: Array<{ path: string; changeType: FileChangeType }>,
    applicationId: string,
    releaseContext: ReleaseEventContext,
    devTicketXyneId?: string | null,
  ): Promise<{
    envChangeCount: number;
    migrationChangeCount: number;
    migrationLinks: Array<{ filePath: string; diffUrl: string }>;
    envChanges: Array<{ fileName: string; filePath: string; newValue: string }>
  }> {

    // Pull this app's env/migration path globs from the DB (configured via
    // the release wizard → Application.envPaths / migrationPaths). The
    // hardcoded XyneChangeDetector singleton is gone; each app's patterns
    // drive its own ChangeDetector.
    const app = await this.applicationRepository!.findById(applicationId);
    const envPatterns = app?.envPaths ?? [];
    const migrationPatterns = app?.migrationPaths ?? [];
    const detector = new ChangeDetector({ envPatterns, migrationPatterns });
    const categorized = detector.categorize(fileChanges);
    logger.info(`[ReleaseChanges] Checking ${filePaths.length} files for env/migration patterns:`);

    const envFiles = categorized.envChanges.map((c) => c.path);
    const migrationFiles = categorized.migrationChanges.map((c) => c.path);

    if (envFiles.length > 0) {
      logger.info(`[ReleaseChanges] MATCHED ${envFiles.length} env files: ${envFiles.join(', ')}`);
    } else {
      logger.info(`[ReleaseChanges] No env file matches (configured patterns: ${envPatterns.join(', ') || '(none — set via release wizard)'})`);
    }

    if (migrationFiles.length > 0) {
      logger.info(`[ReleaseChanges] MATCHED ${migrationFiles.length} migration files: ${migrationFiles.join(', ')}`);
    } else {
      logger.info(`[ReleaseChanges] No migration file matches (configured patterns: ${migrationPatterns.join(', ') || '(none — set via release wizard)'})`);
    }

    let envChangeCount = 0;
    let migrationChangeCount = 0;
    const migrationLinks: Array<{ filePath: string; diffUrl: string }> = [];
    const envChanges: Array<{ fileName: string; filePath: string; newValue: string }> = [];

    // v2: every (app × file × kind × commit) becomes its own ReleaseChangeType
    // row so the Changes tab can list each change individually. The legacy
    // per-(app, kind) lookup is no longer used here.
    for (const filePath of envFiles) {
      try {
        // Re-running analysis for the same release must not insert duplicate
        // change instances (same guard as the PR-diff path).
        const alreadySaved = await this.releaseChangeInstanceExists({
          applicationId,
          changeType: XyneChangeType.ENV,
          releaseId: releaseContext.releaseId,
          applicationReleaseId: releaseContext.applicationReleaseId ?? null,
          devTicketXyneId: devTicketXyneId ?? null,
          commitId,
          filePath,
        });
        if (alreadySaved) continue;

        const fileChange = fileChanges.find(c => c.path === filePath);
        const changeType = fileChange?.changeType ?? FileChangeType.MODIFIED;

        const diff = await this.bitbucketService.getFileDiff(
          projectKey,
          repositorySlug,
          commitId,
          filePath
        );

        // Extract env key from file path (e.g., "env.ts" -> "ENV_CONFIG")
        const fileName = filePath.split('/').pop() || filePath;
        const envDiffResult = DiffParser.parseEnvDiff(diff, fileName);

        const changeInstance = await this.releaseRepository!.createReleaseChangeInstance({
          applicationId,
          changeType: XyneChangeType.ENV,
          releaseId: releaseContext.releaseId,
          applicationReleaseId: releaseContext.applicationReleaseId ?? null,
          devTicketXyneId: devTicketXyneId ?? null,
          commitId,
          filePath,
        });

        // TODO: we should have a factory/service to generate these change requests based on project release type
        const { formValues, payload, message } = this.xyneRelease!.getChange({
          type: XyneChangeType.ENV,
          data: {
            fileName,
            filePath,
            fileSlug: fileName.toUpperCase().replace(/[.\-]/g, '_'),
            changeType: changeType,
            oldValue: envDiffResult.oldValue,
            newValue: envDiffResult.newValue,
            description: envDiffResult.changeSummary,
          }
        });

        await this.releaseRepository!.saveReleaseFormValues(
          changeInstance.id,
          payload,
          message,
          formValues,
          FormContextType.RELEASE_CHANGE,
          FormEntityType.RELEASE_ENV_FORM,
          releaseContext
        );
        envChangeCount++;
        envChanges.push({ fileName, filePath, newValue: diff });
      } catch (error) {
        logger.warn(`Failed to fetch diff for env file ${filePath}:`, error);
      }
    }

    // Fetch and save migration file diffs
    for (const filePath of migrationFiles) {
      try {
        // Re-running analysis for the same release must not insert duplicate
        // change instances (same guard as the PR-diff path).
        const alreadySaved = await this.releaseChangeInstanceExists({
          applicationId,
          changeType: XyneChangeType.MIGRATION,
          releaseId: releaseContext.releaseId,
          applicationReleaseId: releaseContext.applicationReleaseId ?? null,
          devTicketXyneId: devTicketXyneId ?? null,
          commitId,
          filePath,
        });
        if (alreadySaved) continue;

        const diff = await this.bitbucketService.getFileDiff(
          projectKey,
          repositorySlug,
          commitId,
          filePath
        );

        // Extract description from file path
        const fileName = filePath.split('/').pop() || filePath;

        const migDiffResult = DiffParser.parseMigrationDiff(diff, fileName);

        const changeInstance = await this.releaseRepository!.createReleaseChangeInstance({
          applicationId,
          changeType: XyneChangeType.MIGRATION,
          releaseId: releaseContext.releaseId,
          applicationReleaseId: releaseContext.applicationReleaseId ?? null,
          devTicketXyneId: devTicketXyneId ?? null,
          commitId,
          filePath,
        });

        const { formValues, payload, message } = this.xyneRelease!.getChange({
          type: XyneChangeType.MIGRATION,
          data: {
            filePath,
            changeLog: migDiffResult.changeLog,
            description: `Database migration file ${fileName} changed.`,
            query: migDiffResult.query,
          }
        });
        await this.releaseRepository!.saveReleaseFormValues(
          changeInstance.id,
          payload,
          message,
          formValues,
          FormContextType.RELEASE_CHANGE,
          FormEntityType.RELEASE_MIGRATION_FORM,
          releaseContext
        );

        migrationChangeCount++;
        // Construct Bitbucket diff link using projectKey and repositorySlug
        const diffUrl = this.bitbucketService.buildCommitFileUrl(projectKey, repositorySlug, commitId, filePath);
        migrationLinks.push({ filePath, diffUrl });
      } catch (error) {
        logger.warn(`Failed to fetch diff for migration file ${filePath}:`, error);
      }
    }

    logger.info(
      `Saved release changes ${envChangeCount} env files, ${migrationChangeCount} migration files`
    );

    return { envChangeCount, migrationChangeCount, migrationLinks, envChanges };
  }

  async saveReleaseChangesFromPullRequestDiffs(
    projectKey: string,
    repositorySlug: string,
    diffFiles: PullRequestDiffFile[],
    applicationId: string,
    releaseContext: ReleaseEventContext,
    devTicketXyneId?: string | null,
    prUrl?: string | null,
  ): Promise<{
    envChangeCount: number;
    migrationChangeCount: number;
    migrationLinks: Array<{ filePath: string; diffUrl: string }>;
    envChanges: Array<{ fileName: string; filePath: string; newValue: string }>
  }> {
    const app = await this.applicationRepository!.findById(applicationId);
    const envPatterns = app?.envPaths ?? [];
    const migrationPatterns = app?.migrationPaths ?? [];
    const detector = new ChangeDetector({ envPatterns, migrationPatterns });

    const diffByPath = new Map<string, PullRequestDiffFile>();
    const fileChanges: Array<{ path: string; changeType: FileChangeType }> = [];
    for (const file of diffFiles) {
      const path = this.getPullRequestDiffFilePath(file);
      if (!path) continue;

      diffByPath.set(path, file);
      fileChanges.push({
        path,
        changeType: this.mapPullRequestDiffTypeToFileChangeType(file.type),
      });
    }

    const categorized = detector.categorize(fileChanges);
    const envFiles = categorized.envChanges.map((change) => change.path);
    const migrationFiles = categorized.migrationChanges.map((change) => change.path);

    logger.info(
      `[ReleaseChanges] Checking ${fileChanges.length} PR diff files for ${projectKey}/${repositorySlug}: ` +
      `${envFiles.length} env, ${migrationFiles.length} migration matched`,
    );

    let envChangeCount = 0;
    let migrationChangeCount = 0;
    const migrationLinks: Array<{ filePath: string; diffUrl: string }> = [];
    const envChanges: Array<{ fileName: string; filePath: string; newValue: string }> = [];

    for (const filePath of envFiles) {
      try {
        const diffFile = diffByPath.get(filePath);
        if (!diffFile) continue;

        const alreadySaved = await this.releaseChangeInstanceExists({
          applicationId,
          changeType: XyneChangeType.ENV,
          releaseId: releaseContext.releaseId,
          applicationReleaseId: releaseContext.applicationReleaseId ?? null,
          devTicketXyneId: devTicketXyneId ?? null,
          commitId: null,
          filePath,
        });
        if (alreadySaved) continue;

        const diff = this.buildRawDiffFromPullRequestFile(diffFile);
        const fileName = filePath.split('/').pop() || filePath;
        const fileChange = fileChanges.find((change) => change.path === filePath);
        const envDiffResult = DiffParser.parseEnvDiff(diff, fileName);

        const changeInstance = await this.releaseRepository!.createReleaseChangeInstance({
          applicationId,
          changeType: XyneChangeType.ENV,
          releaseId: releaseContext.releaseId,
          applicationReleaseId: releaseContext.applicationReleaseId ?? null,
          devTicketXyneId: devTicketXyneId ?? null,
          commitId: null,
          filePath,
        });

        const { formValues, payload, message } = this.xyneRelease!.getChange({
          type: XyneChangeType.ENV,
          data: {
            fileName,
            filePath,
            fileSlug: fileName.toUpperCase().replace(/[.\-]/g, '_'),
            changeType: fileChange?.changeType ?? FileChangeType.MODIFIED,
            oldValue: envDiffResult.oldValue,
            newValue: envDiffResult.newValue,
            description: envDiffResult.changeSummary,
          },
        });

        await this.releaseRepository!.saveReleaseFormValues(
          changeInstance.id,
          payload,
          message,
          formValues,
          FormContextType.RELEASE_CHANGE,
          FormEntityType.RELEASE_ENV_FORM,
          releaseContext,
        );

        envChangeCount++;
        envChanges.push({ fileName, filePath, newValue: diff });
      } catch (error) {
        logger.warn(`Failed to save PR env release change for ${filePath}:`, error);
      }
    }

    for (const filePath of migrationFiles) {
      try {
        const diffFile = diffByPath.get(filePath);
        if (!diffFile) continue;

        const alreadySaved = await this.releaseChangeInstanceExists({
          applicationId,
          changeType: XyneChangeType.MIGRATION,
          releaseId: releaseContext.releaseId,
          applicationReleaseId: releaseContext.applicationReleaseId ?? null,
          devTicketXyneId: devTicketXyneId ?? null,
          commitId: null,
          filePath,
        });
        if (alreadySaved) continue;

        const diff = this.buildRawDiffFromPullRequestFile(diffFile);
        const fileName = filePath.split('/').pop() || filePath;
        const migDiffResult = DiffParser.parseMigrationDiff(diff, fileName);

        const changeInstance = await this.releaseRepository!.createReleaseChangeInstance({
          applicationId,
          changeType: XyneChangeType.MIGRATION,
          releaseId: releaseContext.releaseId,
          applicationReleaseId: releaseContext.applicationReleaseId ?? null,
          devTicketXyneId: devTicketXyneId ?? null,
          commitId: null,
          filePath,
        });

        const { formValues, payload, message } = this.xyneRelease!.getChange({
          type: XyneChangeType.MIGRATION,
          data: {
            filePath,
            changeLog: migDiffResult.changeLog,
            description: `Database migration file ${fileName} changed.`,
            query: migDiffResult.query,
          },
        });

        await this.releaseRepository!.saveReleaseFormValues(
          changeInstance.id,
          payload,
          message,
          formValues,
          FormContextType.RELEASE_CHANGE,
          FormEntityType.RELEASE_MIGRATION_FORM,
          releaseContext,
        );

        migrationChangeCount++;
        migrationLinks.push({ filePath, diffUrl: prUrl ?? '' });
      } catch (error) {
        logger.warn(`Failed to save PR migration release change for ${filePath}:`, error);
      }
    }

    return { envChangeCount, migrationChangeCount, migrationLinks, envChanges };
  }

  async saveReleaseChangesFromAnalysis(
    projectKey: string,
    repositorySlug: string,
    results: CommitAnalysisResult[],
    applicationId: string,
    releaseContext: ReleaseEventContext
  ): Promise<{
    envChangeCount: number;
    migrationChangeCount: number;
    migrationLinks: Array<{ filePath: string; diffUrl: string }>;
    envChanges: Array<{ fileName: string; filePath: string; newValue: string }>
  }> {
    let totalEnvChanges = 0;
    let totalMigrationChanges = 0;
    const allMigrationLinks: Array<{ filePath: string; diffUrl: string }> = [];
    const allEnvChanges: Array<{ fileName: string; filePath: string; newValue: string }> = [];

    for (const result of results) {
      if (result.filePaths.length === 0) continue;

      try {
        const { envChangeCount, migrationChangeCount, migrationLinks, envChanges } = await this.saveReleaseChangesWithDiffs(
          projectKey,
          repositorySlug,
          result.commitId,
          result.filePaths,
          result.fileChanges,
          applicationId,
          releaseContext,
          result.ticket?.xyneId ?? null,
        );

        totalEnvChanges += envChangeCount;
        totalMigrationChanges += migrationChangeCount;
        allMigrationLinks.push(...migrationLinks);
        allEnvChanges.push(...envChanges);
      } catch (error) {
        logger.warn(`Failed to save release changes for commit ${result.commitId}:`, error);
      }
    }

    logger.info(
      `Total release changes saved ${totalEnvChanges} env, ${totalMigrationChanges} migration`
    );

    return {
      envChangeCount: totalEnvChanges,
      migrationChangeCount: totalMigrationChanges,
      migrationLinks: allMigrationLinks,
      envChanges: allEnvChanges,
    };
  }

  /**
   * Get the path from a change entry, handling DELETE case specially
   */
  private getChangeEntryPath(entry: ChangeEntry): string {
    if (entry.type === 'DELETE' && entry.srcPath?.toString) {
      return entry.srcPath.toString;
    }
    return entry.path.toString || entry.path.components.join('/');
  }

  private getPullRequestDiffFilePath(file: PullRequestDiffFile): string | null {
    return file.newPath ?? file.oldPath ?? file.path ?? file.filename ?? null;
  }

  private mapPullRequestDiffTypeToFileChangeType(type: string | null | undefined): FileChangeType {
    switch (type) {
      case 'add':
        return FileChangeType.ADDED;
      case 'delete':
        return FileChangeType.REMOVED;
      default:
        return FileChangeType.MODIFIED;
    }
  }

  private buildRawDiffFromPullRequestFile(file: PullRequestDiffFile): string {
    return (file.hunks ?? [])
      .map((hunk) => hunk.content ?? '')
      .filter((content) => content.length > 0)
      .join('\n');
  }

  private async releaseChangeInstanceExists(input: {
    applicationId: string;
    changeType: string;
    releaseId: string;
    applicationReleaseId: string | null;
    devTicketXyneId: string | null;
    commitId: string | null;
    filePath: string;
  }): Promise<boolean> {
    const db = DatabaseClient.getInstance();
    const existing = await db.releaseChangeType.findFirst({
      where: {
        applicationId: input.applicationId,
        changeType: input.changeType,
        releaseId: input.releaseId,
        applicationReleaseId: input.applicationReleaseId,
        devTicketXyneId: input.devTicketXyneId,
        commitId: input.commitId,
        filePath: input.filePath,
      },
      select: { id: true },
    });
    return Boolean(existing);
  }

  /**
   * Build the release's env/migration summary from the PERSISTED release_change_types
   * for this release — the source of truth the Envs/Migrations tabs and the release
   * report already read — instead of only the rows saved during the current run.
   *
   * Why: `saveReleaseChangesWithDiffs` skips re-inserting changes that already exist
   * (the dedup guard that protects human QA/sign-off state across re-runs), so a
   * summary accumulated from a single run under-reports on every re-run — reporting
   * "Env/Migration Change: No" even though the changes are persisted. Reading the
   * persisted facts here makes analysis idempotent: the same range always yields the
   * same summary. Env diffs are re-fetched from VCS so the canvas can parse var names;
   * migration links keep the `/commits/<sha>` URL shape the canvas groups on.
   */
  async buildReleaseChangeSummary(
    projectKey: string,
    repositorySlug: string,
    releaseId: string,
    mainReleaseBoardId: string,
  ): Promise<{
    envChangeCount: number;
    migrationChangeCount: number;
    migrationLinks: Array<{ filePath: string; diffUrl: string }>;
    envChanges: Array<{ fileName: string; filePath: string; newValue: string; commitId?: string }>;
  }> {
    const db = DatabaseClient.getInstance();
    // Scope to this repo's applications — release_change_types is releaseId-wide, so
    // an unscoped read would mis-attribute and double-count sibling repos' rows.
    const boardApps = await this.applicationRepository!.findByMainReleaseBoardId(mainReleaseBoardId);
    const applicationIds = boardApps.map(a => a.id);
    if (applicationIds.length === 0) {
      return { envChangeCount: 0, migrationChangeCount: 0, migrationLinks: [], envChanges: [] };
    }
    const changes = await db.releaseChangeType.findMany({
      where: { releaseId, applicationId: { in: applicationIds } },
      orderBy: { createdAt: 'asc' },
    });

    const migrationLinks: Array<{ filePath: string; diffUrl: string }> = [];
    const envChanges: Array<{ fileName: string; filePath: string; newValue: string; commitId?: string }> = [];
    // Cache diffs within this build so a file touched by multiple change rows is
    // fetched once.
    const diffCache = new Map<string, string>();

    for (const change of changes) {
      if (!change.filePath || !change.commitId) continue;

      if (change.changeType === XyneChangeType.MIGRATION) {
        const diffUrl = this.bitbucketService.buildCommitFileUrl(projectKey, repositorySlug, change.commitId, change.filePath);
        migrationLinks.push({ filePath: change.filePath, diffUrl });
        continue;
      }

      if (change.changeType === XyneChangeType.ENV) {
        const cacheKey = `${change.commitId}::${change.filePath}`;
        let diff = diffCache.get(cacheKey);
        if (diff === undefined) {
          try {
            diff = await this.bitbucketService.getFileDiff(
              projectKey,
              repositorySlug,
              change.commitId,
              change.filePath,
            );
          } catch (error) {
            logger.warn(
              `[ReleaseChanges] Failed to re-fetch env diff for ${change.filePath}@${change.commitId}:`,
              error,
            );
            diff = '';
          }
          diffCache.set(cacheKey, diff);
        }
        const fileName = change.filePath.split('/').pop() || change.filePath;
        // Carry commitId so the canvas can key env changes by (commit, path) —
        // otherwise two commits touching the same env file collapse to one.
        envChanges.push({ fileName, filePath: change.filePath, newValue: diff, commitId: change.commitId });
      }
    }

    return {
      envChangeCount: envChanges.length,
      migrationChangeCount: countDistinctMigrationFiles(migrationLinks),
      migrationLinks,
      envChanges,
    };
  }

}
