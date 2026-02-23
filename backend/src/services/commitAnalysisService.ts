import { BitbucketService } from './bitbucketService';
import { TicketRepository } from '@/database/repositories/ticketRepository';
import { ApplicationRepository } from '@/database/repositories/applicationRepository';
import { logger } from '@/utils/logger';
import { PullRequestInfo, DiffstatSummary, ChangeEntry } from '@/types/bitbucket';
import { FormContextType, FormEntityType, } from '@xyne/shared';
import { Application, } from '@prisma/client';
import { XyneRelease } from './release/xyne/xyneRelease';
import { ReleaseRepository } from '@/database/repositories/releaseRepository';
import { XyneChangeType } from './release/xyne/xyneReleaseForm';
import {
  ChangeDetector,
  FileChangeType,
  mapBitbucketChangeType,
  XyneChangeDetector,
  DiffParser,
  ReleaseService
} from './release/core';
export type AnalyzeCommitsRequest =
  | {
    commitIds: string[];
    projectKey: string;
    repositorySlug: string;
    branch?: string;
  }
  | {
    deployedCommitId: string;
    newCommitId: string;
    projectKey: string;
    repositorySlug: string;
    branch?: string;
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
}

export class CommitAnalysisService {
  private bitbucketService: BitbucketService;
  private ticketRepository: TicketRepository | null = null;
  private applicationRepository: ApplicationRepository | null = null;
  private xyneRelease: XyneRelease | null = null;
  private releaseRepository: ReleaseRepository | null = null;
  private changeDetector: ChangeDetector;
  private releaseService: ReleaseService | null = null;

  constructor(bitbucketService: BitbucketService, changeDetector?: ChangeDetector,) {
    this.changeDetector = changeDetector ?? XyneChangeDetector;
    this.bitbucketService = bitbucketService;
    this.initialize();
  }

  /**
   * Initialize service dependencies
   */
  private initialize(): void {
    try {
      if (
        this.ticketRepository &&
        this.applicationRepository &&
        this.xyneRelease &&
        this.releaseRepository &&
        this.releaseService
      ) {
        return;
      }

      this.applicationRepository = new ApplicationRepository();
      // TODO: we should have a factory/service to generate the release change requests
      this.xyneRelease = new XyneRelease();
      this.releaseRepository = new ReleaseRepository();
      this.ticketRepository = new TicketRepository();
      this.releaseService = new ReleaseService(this)
      logger.info('[CommitAnalysisService] Successfully initialized all repositories');
    } catch (error) {
      logger.error('[CommitAnalysisService] Failed to initialize repositories:', error);
    }

  }



  private extractTicketId(prTitle: string): string | null {
    const match = prTitle.match(/^(XYNE-\d+)/);

    if (match) {
      return match[1];
    }

    const anywhereMatch = prTitle.match(/XYNE-\d+/);
    if (anywhereMatch) {
      logger.debug(
        `Ticket ID found in PR title but not at start: "${prTitle}". Using: ${anywhereMatch[0]}`
      );
      return anywhereMatch[0];
    }

    return null;
  }

  private async fetchTicketByXyneId(xyneId: string): Promise<TicketInfo | null> {
    try {
      const ticket = await this.ticketRepository!.getTicketByXyneId(xyneId);

      if (!ticket) {
        logger.debug(`Ticket ${xyneId} not found in database`);
        return null;
      }

      return {
        id: ticket.id,
        xyneId: ticket.xyneId,
        title: ticket.title,
        status: ticket.statusV2,
        priority: ticket.priority,
        assignedTo: ticket.assignedTo,
      };
    } catch (error) {
      logger.error(`Error fetching ticket ${xyneId} from database:`, error);
      return null;
    }
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
    branch?: string
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
      const pullRequest = await this.bitbucketService.getMergedPullRequest(
        projectKey,
        repositorySlug,
        commitId,
        branch
      );

      if (!pullRequest) {
        result.error = 'No merged pull request found for commit';
        logger.info(`Commit ${commitId}: No merged PR found`);
        return result;
      }

      result.pullRequest = pullRequest;
      logger.debug(`Commit ${commitId}: Found PR #${pullRequest.id} - "${pullRequest.title}"`);

      const ticketId = this.extractTicketId(pullRequest.title);

      if (!ticketId) {
        result.error = 'No ticket ID found in PR title';
        logger.info(`Commit ${commitId}: No ticket ID in PR title "${pullRequest.title}"`);
      } else {
        logger.debug(`Commit ${commitId}: Extracted ticket ID ${ticketId}`);

        const ticket = await this.fetchTicketByXyneId(ticketId);

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
      results = await Promise.all(
        commitIds.map((commitId) =>
          this.analyzeEachCommit(commitId, projectKey, repositorySlug, request.branch)
        )
      );
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
    projectId: string,
    filePaths: string[]
  ): Promise<
    (Application & { matchedFiles: string[] })[]
  > {
    logger.info(`Detecting affected applications for project ${projectId}`, {
      fileCount: filePaths.length,
    });

    const applications = await this.applicationRepository!.findByProjectId(projectId);

    if (applications.length === 0) {
      logger.info(`No applications found for project ${projectId}`);
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

  async saveReleaseChangesWithDiffs(
    projectKey: string,
    repositorySlug: string,
    commitId: string,
    filePaths: string[],
    fileChanges: Array<{ path: string; changeType: FileChangeType }>,
    applicationId: string,
    releaseContext: {
      releaseId: string;
      userId: string;
      userName: string;
      channelId: string;
      conversationId: string;
    }
  ): Promise<{
    envChangeCount: number;
    migrationChangeCount: number;
    migrationLinks: Array<{ filePath: string; diffUrl: string }>;
    envChanges: Array<{ fileName: string; filePath: string; newValue: string }>
  }> {

    const categorized = this.changeDetector.categorize(fileChanges);
    logger.info(`[ReleaseChanges] Checking ${filePaths.length} files for env/migration patterns:`);

    const envFiles = categorized.envChanges.map((c) => c.path);
    const migrationFiles = categorized.migrationChanges.map((c) => c.path);

    if (envFiles.length > 0) {
      logger.info(`[ReleaseChanges] MATCHED ${envFiles.length} env files: ${envFiles.join(', ')}`);
    } else {
      logger.info(`[ReleaseChanges] No env file matches (patterns: env.ts, .env, .env.local, .env.example)`);
    }

    if (migrationFiles.length > 0) {
      logger.info(`[ReleaseChanges] MATCHED ${migrationFiles.length} migration files: ${migrationFiles.join(', ')}`);
    } else {
      logger.info(`[ReleaseChanges] No migration file matches (patterns: backend/prisma/migrations/, backend/prisma/schema.prisma)`);
    }

    let envChangeCount = 0;
    let migrationChangeCount = 0;
    const migrationLinks: Array<{ filePath: string; diffUrl: string }> = [];
    const envChanges: Array<{ fileName: string; filePath: string; newValue: string }> = [];

    const releaseEnvChange = await this.releaseRepository!.findReleaseChangeType(XyneChangeType.ENV, applicationId);
    for (const filePath of envFiles) {
      try {
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
        if (releaseEnvChange) {
          // TODO: we should have a factory/service to generate these change requests based on project release type
          const { formValues, payload, message } = this.xyneRelease!.getChange({
            type: XyneChangeType.ENV,
            data: {
              fileName,
              filePath,
              envKey: fileName.toUpperCase().replace(/[.\-]/g, '_'),
              changeType: changeType,
              oldValue: envDiffResult.oldValue,
              newValue: envDiffResult.newValue,
              description: envDiffResult.changeSummary,
            }
          })

          await this.releaseService!.saveReleaseFormValues(
            releaseEnvChange.id,
            payload,
            message,
            formValues,
            FormContextType.RELEASE_CHANGE,
            FormEntityType.RELEASE_ENV_FORM,
            { ...releaseContext, applicationId }
          );
        }
        envChangeCount++;
        envChanges.push({ fileName, filePath, newValue: diff });
      } catch (error) {
        logger.warn(`Failed to fetch diff for env file ${filePath}:`, error);
      }
    }

    // Fetch and save migration file diffs
    const releaseMigChange = await this.releaseRepository!.findReleaseChangeType(XyneChangeType.MIGRATION, applicationId);
    for (const filePath of migrationFiles) {
      try {
        const diff = await this.bitbucketService.getFileDiff(
          projectKey,
          repositorySlug,
          commitId,
          filePath
        );

        // Extract description from file path
        const fileName = filePath.split('/').pop() || filePath;

        const migDiffResult = DiffParser.parseMigrationDiff(diff, fileName);
        if (releaseMigChange) {
          const { formValues, payload, message } = this.xyneRelease!.getChange({
            type: XyneChangeType.MIGRATION,
            data: {
              filePath,
              changeLog: migDiffResult.changeLog,
              description: `Database migration file ${fileName} changed.`,
              query: migDiffResult.query,
            }
          })
          await this.releaseService!.saveReleaseFormValues(
            releaseMigChange.id,
            payload,
            message,
            formValues,
            FormContextType.RELEASE_CHANGE,
            FormEntityType.RELEASE_MIGRATION_FORM,
            { ...releaseContext, applicationId }
          );
        }

        migrationChangeCount++;
        // Construct Bitbucket diff link using projectKey and repositorySlug
        const diffUrl = `https://bitbucket.example.com/projects/${projectKey}/repos/${repositorySlug}/commits/${commitId}#${filePath}`;
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

  async saveReleaseChangesFromAnalysis(
    projectKey: string,
    repositorySlug: string,
    results: CommitAnalysisResult[],
    applicationId: string,
    releaseContext: {
      releaseId: string;
      userId: string;
      userName: string;
      channelId: string;
      conversationId: string;
    }
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
          releaseContext
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

}
