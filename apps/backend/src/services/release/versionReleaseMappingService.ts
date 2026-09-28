import { Application, Prisma, PullRequests } from '@prisma/client';
import { ApplicationRepository } from '@/database/repositories/applicationRepository';
import { DatabaseClient } from '@/database/client';
import { getGitProvider } from '@/git-providers/factory';
import { ReleaseRepository } from '@/database/repositories/releaseRepository';
import { upsertCommitAnalysisCanvas } from '@/utils/commitAnalysisCanvas';
import { BitbucketService } from '@/services/bitbucketService';
import { CommitAnalysisResult, CommitAnalysisService, PullRequestDiffFile } from '@/services/commitAnalysisService';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { parseBitbucketRepoUrl, parseGitHubRepoUrl } from '@/utils/repoUrlParser';
import { BitbucketConfig } from '@/types/bitbucket';
import {
  BaseTicketType,
  BoardType,
  FormEntityType,
  ReleaseEventType,
  ReleaseTrackingMode,
  isReleaseTicket, PRStatus, TicketStatusV2 } from '@xyne/shared';

const prisma = DatabaseClient.getInstance();

type TicketWithReleaseBoard = Prisma.TicketGetPayload<{
  include: { project: true; board: true };
}>;
type AffectedApplication = Application & { matchedFiles: string[] };
type PullRequestDiffContext = {
  pr: PullRequests;
  projectKey: string;
  repoSlug: string;
  diffFiles: PullRequestDiffFile[];
  filePaths: string[];
};
type CanvasEnvChange = { filePath: string; fileName: string; newValue: string; applicationId?: string };
type CanvasMigrationLink = { filePath: string; diffUrl: string; applicationId?: string };
type PerAppSubTickets = Map<string, { subTicketId: string; mappedTicketId: string; xyneId: string }>;
type DevTicketMapping = {
  devTicket: TicketWithReleaseBoard;
  affectedApps: AffectedApplication[];
  perAppSubTickets: PerAppSubTickets;
  prDiffContexts: PullRequestDiffContext[];
  envChanges: CanvasEnvChange[];
  migrationLinks: CanvasMigrationLink[];
  insertedCount: number;
};
type StaleVersionReleaseMapping = {
  artId: string;
  releaseId: string;
  applicationReleaseId: string;
  devTicketXyneId: string | null;
};

function buildBitbucketServiceConfig(): BitbucketConfig {
  const bitbucketConfig = config.bitbucket;
  return {
    baseUrl: bitbucketConfig.baseUrl
      ? (bitbucketConfig.baseUrl.endsWith('/rest/api/latest')
        ? bitbucketConfig.baseUrl
        : `${bitbucketConfig.baseUrl}/rest/api/latest`)
      : 'https://bitbucket.example.com/rest/api/latest',
    username: bitbucketConfig.apiUsername || '',
    password: bitbucketConfig.password || '',
    token: bitbucketConfig.apiToken || '',
  };
}

class VersionReleaseMappingService {
  private readonly applicationRepository = new ApplicationRepository();
  private readonly releaseRepository = new ReleaseRepository();
  private readonly commitAnalysisService = new CommitAnalysisService(
    new BitbucketService(buildBitbucketServiceConfig()),
  );

  // Serializes syncs per ticket: rapid successive releaseVersion edits used to
  // run concurrently and interleave SubTicket/ART writes. Each queued run
  // re-reads the current version, so the latest edit always wins.
  private readonly pendingSyncs = new Map<string, Promise<void>>();

  // Every releaseVersion edit replays every dev ticket on the version, so cache
  // PR diffs across replays instead of refetching each one from the provider.
  // ponytail: in-process TTL; a new push is picked up once the entry expires.
  private readonly prDiffCache = new Map<string, { diffFiles: PullRequestDiffFile[]; fetchedAt: number }>();
  private static readonly PR_DIFF_CACHE_TTL_MS = 5 * 60_000;

  async syncTicketById(ticketId: string): Promise<void> {
    const previous = this.pendingSyncs.get(ticketId) ?? Promise.resolve();
    const run = previous.then(() => this.runSyncTicketById(ticketId));
    this.pendingSyncs.set(ticketId, run);
    try {
      await run;
    } finally {
      if (this.pendingSyncs.get(ticketId) === run) {
        this.pendingSyncs.delete(ticketId);
      }
    }
  }

  private async runSyncTicketById(ticketId: string): Promise<void> {
    try {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: { project: true, board: true },
      });
      if (!ticket) {
        logger.warn(`[VersionReleaseMapping] skipped: ticket ${ticketId} not found`);
        return;
      }

      const releaseVersion = await this.getTicketReleaseVersion(ticket.id);
      if (isReleaseTicket(ticket.ticketType as BaseTicketType)) {
        await this.syncReleaseTicket(ticket, releaseVersion);
      } else {
        await this.syncDevTicket(ticket, releaseVersion);
      }
    } catch (error) {
      logger.error(`[VersionReleaseMapping] failed for ticket ${ticketId}:`, error);
    }
  }

  private async syncReleaseTicket(
    releaseTicket: TicketWithReleaseBoard,
    releaseVersion: string | null,
  ): Promise<void> {
    if (releaseTicket.board?.releaseTrackingMode !== ReleaseTrackingMode.VERSION) {
      return;
    }

    await this.cleanupReleaseRowsForCurrentVersion(releaseTicket.id, releaseVersion);
    if (!releaseVersion) {
      logger.info(`[VersionReleaseMapping] release ${releaseTicket.xyneId} has no releaseVersion`);
      return;
    }

    const devTickets = await this.findDevTicketsByVersion(releaseTicket.projectId, releaseVersion);
    const mappings: DevTicketMapping[] = [];
    for (const devTicket of devTickets) {
      try {
        const mapping = await this.mapDevTicketToRelease(devTicket, releaseTicket);
        if (mapping) mappings.push(mapping);
      } catch (error) {
        // One bad ticket must not leave the rest of the release unmapped.
        logger.error(
          `[VersionReleaseMapping] failed to map ${devTicket.xyneId} to ${releaseTicket.xyneId}:`,
          error,
        );
      }
    }

    await this.publishReleaseArtifacts(releaseTicket, releaseVersion, mappings);
  }

  private async syncDevTicket(
    devTicket: TicketWithReleaseBoard,
    releaseVersion: string | null,
  ): Promise<void> {
    await this.cleanupDevRowsForCurrentVersion(devTicket, releaseVersion);
    if (!releaseVersion) {
      logger.info(`[VersionReleaseMapping] dev ticket ${devTicket.xyneId} has no releaseVersion`);
      return;
    }

    // Re-sync from the release side: the timeline and canvas describe the whole
    // release, so they have to be rebuilt from every dev ticket on this version,
    // not just the one that was edited. Mapping is idempotent, so replaying it is safe.
    const releases = await this.findReleaseTicketsByVersion(devTicket.projectId, releaseVersion);
    for (const releaseTicket of releases) {
      await this.syncReleaseTicket(releaseTicket, releaseVersion);
    }
  }

  /** Timeline events + the release-analysis canvas for a version release. */
  private async publishReleaseArtifacts(
    releaseTicket: TicketWithReleaseBoard,
    releaseVersion: string,
    mappings: DevTicketMapping[],
  ): Promise<void> {
    const { channelId, conversationId } = releaseTicket;
    if (!channelId || !conversationId) return;

    const affectedApps = new Map<string, AffectedApplication>();
    const envChanges: CanvasEnvChange[] = [];
    const migrationLinks: CanvasMigrationLink[] = [];
    for (const mapping of mappings) {
      for (const app of mapping.affectedApps) affectedApps.set(app.id, app);
      envChanges.push(...mapping.envChanges);
      migrationLinks.push(...mapping.migrationLinks);
    }

    const userName = await this.getReleaseEventUserName(releaseTicket.createdBy);
    const emit = async (
      eventType: ReleaseEventType,
      eventName: string,
      message: string,
      applicationReleaseId?: string,
    ): Promise<void> => {
      try {
        await this.releaseRepository.createReleaseEvent({
          releaseId: releaseTicket.id,
          applicationReleaseId,
          eventType,
          eventName,
          message,
          userId: releaseTicket.createdBy,
          userName,
          channelId,
          conversationId,
        });
      } catch (error) {
        // Observability only — never fail a sync because the timeline did not write.
        logger.warn(`[VersionReleaseMapping] failed to emit ${eventName}:`, error);
      }
    };

    // Replays re-run every mapping; only a ticket that newly joined gets a timeline line.
    for (const mapping of mappings.filter(m => m.insertedCount > 0)) {
      const apps = mapping.affectedApps.map(app => app.name).join(', ');
      await emit(
        ReleaseEventType.TICKET,
        'DEV_TICKET_LINKED',
        `${mapping.devTicket.xyneId} joined ${releaseVersion} (${apps})`,
        mapping.perAppSubTickets.get(mapping.affectedApps[0]?.id ?? '')?.subTicketId,
      );
    }

    const migrationCount = new Set(migrationLinks.map(link => link.filePath)).size;
    const summary = `Version ${releaseVersion}: ${mappings.length} dev ticket${mappings.length === 1 ? '' : 's'}, `
      + `${affectedApps.size} app${affectedApps.size === 1 ? '' : 's'}, `
      + `${envChanges.length} env change${envChanges.length === 1 ? '' : 's'}, `
      + `${migrationCount} migration${migrationCount === 1 ? '' : 's'}`;
    const lastSummary = await prisma.releaseEvent.findFirst({
      where: { releaseId: releaseTicket.id, eventName: 'VERSION_ANALYSIS_COMPLETED' },
      orderBy: { createdAt: 'desc' },
      select: { message: true },
    });
    if (lastSummary?.message !== summary) {
      await emit(ReleaseEventType.RELEASE, 'VERSION_ANALYSIS_COMPLETED', summary);
    }

    await this.upsertVersionReleaseCanvas(
      releaseTicket,
      releaseVersion,
      mappings,
      Array.from(affectedApps.values()),
      envChanges,
      migrationLinks,
    );
  }

  private async mapDevTicketToRelease(
    devTicket: TicketWithReleaseBoard,
    releaseTicket: TicketWithReleaseBoard,
  ): Promise<DevTicketMapping | null> {
    if (
      !releaseTicket.boardId
      || releaseTicket.board?.releaseTrackingMode !== ReleaseTrackingMode.VERSION
    ) {
      return null;
    }

    const pullRequests = await prisma.pullRequests.findMany({
      where: {
        ticketId: devTicket.id,
        status: { not: PRStatus.DELETED },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (pullRequests.length === 0) {
      logger.info(`[VersionReleaseMapping] skipped ${devTicket.xyneId}: no linked PR rows`);
      return null;
    }

    const { affectedApps, prLinksByApplication, prDiffContexts } = await this.detectAffectedApplicationsFromPRs(
      releaseTicket.boardId,
      pullRequests,
    );
    if (affectedApps.length === 0) {
      logger.info(`[VersionReleaseMapping] skipped ${devTicket.xyneId}: no affected applications from PR diffs`);
      return null;
    }

    const perAppSubTickets = await this.ensureApplicationReleaseSubTickets(
      releaseTicket,
      affectedApps,
      prLinksByApplication,
    );

    const records = affectedApps
      .map(app => {
        const perApp = perAppSubTickets.get(app.id);
        if (!perApp) return null;
        return {
          applicationReleaseId: perApp.subTicketId,
          releaseId: releaseTicket.id,
          devTicketId: devTicket.id,
        };
      })
      .filter((record): record is NonNullable<typeof record> => record !== null);

    if (records.length === 0) {
      logger.info(`[VersionReleaseMapping] skipped ${devTicket.xyneId}: no application sub-tickets available`);
      return null;
    }

    const result = await this.applicationRepository.createApplicationReleaseTicketMappings(records);
    logger.info(
      `[VersionReleaseMapping] mapped dev ticket ${devTicket.xyneId} to release ${releaseTicket.xyneId}: ` +
      `attempted=${records.length}, inserted=${result.count}`,
    );

    const { envChanges, migrationLinks } = await this.saveReleaseChangesForAffectedApps(
      releaseTicket,
      devTicket,
      affectedApps,
      perAppSubTickets,
      prDiffContexts,
    );

    return {
      devTicket,
      affectedApps,
      perAppSubTickets,
      prDiffContexts,
      envChanges,
      migrationLinks,
      insertedCount: result.count,
    };
  }

  private async detectAffectedApplicationsFromPRs(
    mainReleaseBoardId: string,
    pullRequests: PullRequests[],
  ): Promise<{
    affectedApps: AffectedApplication[];
    prLinksByApplication: Map<string, string[]>;
    prDiffContexts: PullRequestDiffContext[];
  }> {
    const affectedByAppId = new Map<string, AffectedApplication>();
    const prLinksByApplication = new Map<string, string[]>();
    const prDiffContexts: PullRequestDiffContext[] = [];

    // The board's applications don't change mid-sync — fetch once instead of
    // once per PR.
    const boardApplications = await prisma.application.findMany({
      where: { mainReleaseBoardId },
    });

    for (const pr of pullRequests) {
      const diffContext = await this.getPullRequestDiffContext(pr);
      if (!diffContext || diffContext.filePaths.length === 0) continue;

      prDiffContexts.push(diffContext);

      const apps = this.detectAffectedApplications(
        boardApplications,
        diffContext.filePaths,
      );

      // The diff had files but none matched any application regex on this board.
      // Without this log the sync silently yields zero affected apps and no ART rows,
      // which is very hard to diagnose. The usual cause is a misconfigured
      // Application.regex (e.g. `^/`, which never matches repo-relative diff paths) or
      // no Application scoped to the release board (empty regex list below).
      if (apps.length === 0) {
        logger.warn(
          `[VersionReleaseMapping] PR ${pr.prUrl} diff had ${diffContext.filePaths.length} file(s) but ` +
            `none matched any application regex on board ${mainReleaseBoardId}. ` +
            `App regexes tried: [${boardApplications.map(a => `${a.name}=${a.regex}`).join(', ')}]. ` +
            `Sample files: [${diffContext.filePaths.slice(0, 5).join(', ')}]`,
        );
      }

      for (const app of apps) {
        const existing = affectedByAppId.get(app.id);
        if (existing) {
          existing.matchedFiles = Array.from(new Set([...existing.matchedFiles, ...app.matchedFiles]));
        } else {
          affectedByAppId.set(app.id, app);
        }

        const links = prLinksByApplication.get(app.id) ?? [];
        if (pr.prUrl && !links.includes(pr.prUrl)) links.push(pr.prUrl);
        prLinksByApplication.set(app.id, links);
      }
    }

    return {
      affectedApps: Array.from(affectedByAppId.values()),
      prLinksByApplication,
      prDiffContexts,
    };
  }

  private async getPullRequestDiffContext(pr: PullRequests): Promise<PullRequestDiffContext | null> {
    // GitHub's owner/repo and Bitbucket's projectKey/repoSlug occupy the same two
    // positional args, so parse with the provider that actually hosts the PR —
    // asking Bitbucket for a GitHub PR yields an empty diff and no affected apps.
    const gitHubRepo = parseGitHubRepoUrl(pr.repositoryUrl);
    const parsed = gitHubRepo
      ? { projectKey: gitHubRepo.owner, repoSlug: gitHubRepo.repo }
      : parseBitbucketRepoUrl(pr.repositoryUrl);
    if (!parsed) {
      logger.warn(`[VersionReleaseMapping] skipped PR ${pr.prUrl}: cannot parse repositoryUrl=${pr.repositoryUrl}`);
      return null;
    }

    try {
      const cacheKey = `${pr.repositoryUrl}#${pr.prId}`;
      const cached = this.prDiffCache.get(cacheKey);
      let diffFiles = cached && Date.now() - cached.fetchedAt < VersionReleaseMappingService.PR_DIFF_CACHE_TTL_MS
        ? cached.diffFiles
        : null;
      if (!diffFiles) {
        diffFiles = await getGitProvider(pr.repositoryUrl)
          .getPRDiff(parsed.projectKey, parsed.repoSlug, pr.prId);
        this.prDiffCache.set(cacheKey, { diffFiles, fetchedAt: Date.now() });
      }
      return {
        pr,
        projectKey: parsed.projectKey,
        repoSlug: parsed.repoSlug,
        diffFiles,
        filePaths: this.extractDiffFilePaths(diffFiles),
      };
    } catch (error) {
      logger.error(`[VersionReleaseMapping] failed to fetch diff for PR ${pr.prUrl}:`, error);
      return null;
    }
  }

  private extractDiffFilePaths(diffFiles: PullRequestDiffFile[]): string[] {
    const paths = new Set<string>();
    for (const file of diffFiles) {
      const path = this.getDiffFilePath(file);
      if (path) paths.add(path);
    }
    return Array.from(paths);
  }

  private getDiffFilePath(file: PullRequestDiffFile): string | null {
    return file.newPath ?? file.oldPath ?? file.path ?? file.filename ?? null;
  }

  private async saveReleaseChangesForAffectedApps(
    releaseTicket: TicketWithReleaseBoard,
    devTicket: TicketWithReleaseBoard,
    affectedApps: AffectedApplication[],
    perAppSubTickets: PerAppSubTickets,
    prDiffContexts: PullRequestDiffContext[],
  ): Promise<{ envChanges: CanvasEnvChange[]; migrationLinks: CanvasMigrationLink[] }> {
    const userName = await this.getReleaseEventUserName(releaseTicket.createdBy);
    const envChanges: CanvasEnvChange[] = [];
    const migrationLinks: CanvasMigrationLink[] = [];

    for (const app of affectedApps) {
      const perApp = perAppSubTickets.get(app.id);
      if (!perApp) continue;

      const matchedFiles = new Set(app.matchedFiles);
      for (const diffContext of prDiffContexts) {
        const appDiffFiles = diffContext.diffFiles.filter((file) => {
          const path = this.getDiffFilePath(file);
          return path ? matchedFiles.has(path) : false;
        });
        if (appDiffFiles.length === 0) continue;

        try {
          const result = await this.commitAnalysisService.saveReleaseChangesFromPullRequestDiffs(
            diffContext.projectKey,
            diffContext.repoSlug,
            appDiffFiles,
            app.id,
            {
              releaseId: releaseTicket.id,
              applicationReleaseId: perApp.subTicketId,
              userId: releaseTicket.createdBy,
              userName,
              channelId: releaseTicket.channelId,
              conversationId: releaseTicket.conversationId,
            },
            devTicket.xyneId,
            diffContext.pr.prUrl,
          );

          // Keep the detail, not just the counts — the release canvas renders it.
          envChanges.push(...result.envChanges.map(change => ({ ...change, applicationId: app.id })));
          migrationLinks.push(...result.migrationLinks.map(link => ({ ...link, applicationId: app.id })));

          logger.info(
            `[VersionReleaseMapping] saved release changes for ${releaseTicket.xyneId}/${app.name}: ` +
            `${result.envChangeCount} env, ${result.migrationChangeCount} migration`,
          );
        } catch (error) {
          logger.error(
            `[VersionReleaseMapping] failed to save release changes for ${releaseTicket.xyneId}/${app.name}:`,
            error,
          );
        }
      }
    }

    return { envChanges, migrationLinks };
  }

  /**
   * Render the release-analysis canvas from version-mode data. The canvas is
   * keyed on the release conversation, so this create-or-updates the same one on
   * every re-sync rather than minting a new canvas per edit.
   */
  private async upsertVersionReleaseCanvas(
    releaseTicket: TicketWithReleaseBoard,
    releaseVersion: string,
    mappings: DevTicketMapping[],
    affectedApps: AffectedApplication[],
    envChanges: CanvasEnvChange[],
    migrationLinks: CanvasMigrationLink[],
  ): Promise<void> {
    const firstContext = mappings[0]?.prDiffContexts[0];
    if (!firstContext) return;

    // PR rows carry no author, so credit the dev ticket's creator; the email lets
    // the canvas render them as a mention.
    const creators = new Map(
      (await prisma.user.findMany({
        where: { id: { in: mappings.map(mapping => mapping.devTicket.createdBy) } },
        select: { id: true, email: true, displayName: true, name: true },
      })).map(user => [user.id, user]),
    );

    // One canvas "result" per PR: the renderers key on pullRequest.id, and a
    // version release has no commit range to walk.
    const results: CommitAnalysisResult[] = mappings.flatMap(mapping => {
      const creator = creators.get(mapping.devTicket.createdBy);
      const author = {
        id: 0,
        displayName: creator?.displayName ?? creator?.name ?? creator?.email ?? mapping.devTicket.createdBy,
        emailAddress: creator?.email,
      };
      return mapping.prDiffContexts.map(context => ({
        commitId: `pr-${context.pr.prId}`,
        pullRequest: {
          id: context.pr.prId,
          title: mapping.devTicket.title,
          url: context.pr.prUrl ?? '',
          state: context.pr.status,
          author,
        },
        ticket: {
          id: mapping.devTicket.id,
          xyneId: mapping.devTicket.xyneId,
          title: mapping.devTicket.title,
          status: mapping.devTicket.stageName ?? '',
          priority: '',
          assignedTo: null,
          ticketType: mapping.devTicket.ticketType,
        },
        foldersChanged: [],
        filePaths: context.filePaths,
        fileChanges: [],
        diffstat: null,
        environment: null,
        migration: null,
        error: null,
      }));
    });

    try {
      const canvasId = await upsertCommitAnalysisCanvas({
        section: 'main',
        results,
        affectedApplications: affectedApps.map(app => ({
          id: app.id,
          name: app.name,
          matchedFiles: app.matchedFiles,
          subTicketId: mappings
            .map(mapping => mapping.perAppSubTickets.get(app.id)?.subTicketId)
            .find(Boolean),
        })),
        envChanges,
        migrationLinks,
        createdByUserId: releaseTicket.createdBy,
        metadata: {
          projectId: releaseTicket.projectId,
          conversationId: releaseTicket.conversationId ?? undefined,
          channelId: releaseTicket.channelId ?? undefined,
          workspaceId: releaseTicket.workspaceId,
          workspace: firstContext.projectKey,
          repoSlug: firstContext.repoSlug,
          releaseVersion,
          deployedCommitId: '',
          newCommitId: '',
          affectedApplicationCount: affectedApps.length,
          migrationCount: new Set(migrationLinks.map(link => link.filePath)).size,
          envChangeCount: envChanges.length,
        },
      });
      logger.info(
        `[VersionReleaseMapping] release notes canvas ${canvasId ?? 'not created'} for ${releaseTicket.xyneId}`,
      );
    } catch (error) {
      logger.error(`[VersionReleaseMapping] failed to build canvas for ${releaseTicket.xyneId}:`, error);
    }
  }

  private async getReleaseEventUserName(userId: string): Promise<string> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, name: true, email: true },
    });
    return user?.displayName ?? user?.name ?? user?.email ?? userId;
  }

  private detectAffectedApplications(
    applications: Application[],
    filePaths: string[],
  ): AffectedApplication[] {
    const affectedAppsMap = new Map<string, AffectedApplication>();

    for (const filePath of filePaths) {
      for (const application of applications) {
        if (!this.matchesApplication(filePath, application.regex)) continue;

        const existing = affectedAppsMap.get(application.id);
        if (existing) {
          existing.matchedFiles.push(filePath);
        } else {
          affectedAppsMap.set(application.id, {
            ...application,
            matchedFiles: [filePath],
          });
        }
      }
    }

    return Array.from(affectedAppsMap.values()).map(app => ({
      ...app,
      matchedFiles: Array.from(new Set(app.matchedFiles)),
    }));
  }

  private matchesApplication(filePath: string, applicationRegex: string): boolean {
    try {
      return new RegExp(applicationRegex).test(filePath);
    } catch (error) {
      logger.warn(`[VersionReleaseMapping] invalid application regex=${applicationRegex}`, error);
      return false;
    }
  }

  private async ensureApplicationReleaseSubTickets(
    releaseTicket: TicketWithReleaseBoard,
    affectedApps: AffectedApplication[],
    prLinksByApplication: Map<string, string[]>,
  ): Promise<Map<string, { subTicketId: string; mappedTicketId: string; xyneId: string }>> {
    const existing = await this.findExistingApplicationReleaseSubTickets(releaseTicket.id, affectedApps);
    const missingApps = affectedApps.filter(app => !existing.has(app.id));

    if (missingApps.length > 0) {
      const created = await this.applicationRepository.createApplicationSubTickets({
        parentTicketId: releaseTicket.id,
        parentTitle: releaseTicket.title,
        projectId: releaseTicket.projectId,
        channelId: releaseTicket.channelId,
        conversationId: releaseTicket.conversationId,
        createdBy: releaseTicket.createdBy,
        affectedApplications: missingApps,
        prLinksByApplication,
        isHotFix: releaseTicket.ticketType === BaseTicketType.Hotfix,
      });
      for (const [appId, value] of created) {
        existing.set(appId, value);
      }
    }

    return existing;
  }

  private async findExistingApplicationReleaseSubTickets(
    releaseTicketId: string,
    affectedApps: AffectedApplication[],
  ): Promise<Map<string, { subTicketId: string; mappedTicketId: string; xyneId: string }>> {
    const appByBoardId = new Map(
      affectedApps
        .filter(app => !!app.boardId)
        .map(app => [app.boardId!, app]),
    );
    const result = new Map<string, { subTicketId: string; mappedTicketId: string; xyneId: string }>();

    if (appByBoardId.size === 0) return result;

    const mappings = await prisma.ticketSubTicketMapping.findMany({
      where: { ticketId: releaseTicketId },
      include: { subTicket: { include: { mappedTicket: true } } },
    });

    for (const mapping of mappings) {
      const mappedTicket = mapping.subTicket.mappedTicket;
      if (!mappedTicket) continue;

      const app = appByBoardId.get(mappedTicket.boardId);
      if (!app || result.has(app.id)) continue;

      result.set(app.id, {
        subTicketId: mapping.subTicket.id,
        mappedTicketId: mappedTicket.id,
        xyneId: mappedTicket.xyneId,
      });
    }

    return result;
  }

  private async findReleaseTicketsByVersion(
    projectId: string,
    releaseVersion: string,
  ): Promise<TicketWithReleaseBoard[]> {
    const ticketIds = await this.findTicketIdsByReleaseVersion(releaseVersion);
    if (ticketIds.length === 0) return [];

    return prisma.ticket.findMany({
      where: {
        id: { in: ticketIds },
        projectId,
        ticketType: { in: [BaseTicketType.Release, BaseTicketType.Hotfix] },
        isArchived: false,
        board: {
          releaseTrackingMode: ReleaseTrackingMode.VERSION,
        },
      },
      include: { project: true, board: true },
    });
  }

  private async findDevTicketsByVersion(
    projectId: string,
    releaseVersion: string,
  ): Promise<TicketWithReleaseBoard[]> {
    const ticketIds = await this.findTicketIdsByReleaseVersion(releaseVersion);
    if (ticketIds.length === 0) return [];

    return prisma.ticket.findMany({
      where: {
        id: { in: ticketIds },
        projectId,
        isArchived: false,
        OR: [
          { ticketType: null },
          { ticketType: { notIn: [BaseTicketType.Release, BaseTicketType.Hotfix] } },
        ],
      },
      include: { project: true, board: true },
    });
  }

  private async findTicketIdsByReleaseVersion(releaseVersion: string): Promise<string[]> {
    const releaseVersionFieldIds = await this.getReleaseVersionFieldIds();
    if (releaseVersionFieldIds.length === 0) return [];

    // Match in the DB — form_entity_values grows with total ticket count, so
    // loading every versioned ticket's row to compare in JS scans the whole
    // table on each version edit. JSON equality is the same pattern
    // genericQueryBuilder uses for this column; unlike the old JS filter it
    // won't match values stored with stray whitespace, which input
    // normalization should prevent at write time.
    const values = await prisma.formEntityValues.findMany({
      where: {
        entityType: FormEntityType.TICKET,
        fieldId: { in: releaseVersionFieldIds },
        actualFieldValue: { equals: releaseVersion },
      },
      select: { entityId: true },
    });
    return Array.from(new Set(values.map(value => value.entityId)));
  }

  private async getTicketReleaseVersion(ticketId: string): Promise<string | null> {
    const versions = await this.getTicketReleaseVersions([ticketId]);
    return versions.get(ticketId) ?? null;
  }

  /** Latest non-empty releaseVersion per ticket, resolved in one query. */
  private async getTicketReleaseVersions(
    ticketIds: string[],
  ): Promise<Map<string, string | null>> {
    const versions = new Map<string, string | null>(ticketIds.map(id => [id, null]));
    if (ticketIds.length === 0) return versions;

    const releaseVersionFieldIds = await this.getReleaseVersionFieldIds();
    if (releaseVersionFieldIds.length === 0) return versions;

    const values = await prisma.formEntityValues.findMany({
      where: {
        entityId: { in: ticketIds },
        entityType: FormEntityType.TICKET,
        fieldId: { in: releaseVersionFieldIds },
      },
      select: { entityId: true, actualFieldValue: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });

    for (const value of values) {
      if (versions.get(value.entityId)) continue; // newest non-empty value wins
      const normalized = this.normalizeVersion(value.actualFieldValue);
      if (normalized) versions.set(value.entityId, normalized);
    }
    return versions;
  }

  private releaseVersionFieldIdsCache: { ids: string[]; fetchedAt: number } | null = null;

  private async getReleaseVersionFieldIds(): Promise<string[]> {
    // fieldName has no serving index (only [formId, fieldName]) and the set of
    // releaseVersion fields changes only when forms are (re)seeded, so a short
    // cache avoids re-scanning form_fields on every per-row lookup.
    const cacheTtlMs = 60_000;
    const cached = this.releaseVersionFieldIdsCache;
    if (cached && Date.now() - cached.fetchedAt < cacheTtlMs) return cached.ids;

    const fields = await prisma.formFields.findMany({
      where: { fieldName: 'releaseVersion' },
      select: { id: true },
    });
    const ids = fields.map(field => field.id);
    this.releaseVersionFieldIdsCache = { ids, fetchedAt: Date.now() };
    return ids;
  }

  private async cleanupDevRowsForCurrentVersion(
    devTicket: TicketWithReleaseBoard,
    currentVersion: string | null,
  ): Promise<void> {
    const rows = await prisma.applicationReleaseTicket.findMany({
      where: { ticketId: devTicket.id },
      select: { id: true, releaseId: true, applicationReleaseId: true },
    });
    if (rows.length === 0) return;

    const releases = await prisma.ticket.findMany({
      where: {
        id: { in: rows.map(row => row.releaseId) },
        board: { releaseTrackingMode: ReleaseTrackingMode.VERSION },
      },
      include: { project: true, board: true },
    });
    const releaseById = new Map(releases.map(release => [release.id, release]));

    const releaseVersions = await this.getTicketReleaseVersions(
      releases.map(release => release.id),
    );
    const staleMappings = rows
      .filter(row => {
        if (!releaseById.has(row.releaseId)) return false;
        return (releaseVersions.get(row.releaseId) ?? null) !== currentVersion;
      })
      .map(row => ({
        artId: row.id,
        releaseId: row.releaseId,
        applicationReleaseId: row.applicationReleaseId,
        devTicketXyneId: devTicket.xyneId,
      }));

    if (staleMappings.length > 0) {
      const result = await this.cleanupStaleVersionReleaseMappings(staleMappings);
      logger.info(
        `[VersionReleaseMapping] removed stale data for dev ticket ${devTicket.id}: ` +
        `ART=${result.artRowsDeleted}, changes=${result.releaseChangesDeleted}, ` +
        `formValues=${result.formValuesDeleted}`,
      );
    }
  }

  private async cleanupReleaseRowsForCurrentVersion(
    releaseTicketId: string,
    currentVersion: string | null,
  ): Promise<void> {
    const rows = await prisma.applicationReleaseTicket.findMany({
      where: { releaseId: releaseTicketId },
      select: { id: true, ticketId: true, applicationReleaseId: true },
    });
    if (rows.length === 0) return;

    const devTicketIds = Array.from(new Set(rows.map(row => row.ticketId)));
    const [devVersions, devTickets] = await Promise.all([
      this.getTicketReleaseVersions(devTicketIds),
      prisma.ticket.findMany({
        where: { id: { in: devTicketIds } },
        select: { id: true, xyneId: true },
      }),
    ]);
    const devTicketXyneIdById = new Map(
      devTickets.map(ticket => [ticket.id, ticket.xyneId]),
    );

    const staleMappings = rows
      .filter(row => (devVersions.get(row.ticketId) ?? null) !== currentVersion)
      .map(row => ({
        artId: row.id,
        releaseId: releaseTicketId,
        applicationReleaseId: row.applicationReleaseId,
        // ART has no DB foreign key to Ticket. Keep enough information to
        // delete an orphaned ART row even if its dev ticket was already removed.
        devTicketXyneId: devTicketXyneIdById.get(row.ticketId) ?? null,
      }));

    if (staleMappings.length > 0) {
      const result = await this.cleanupStaleVersionReleaseMappings(staleMappings);
      logger.info(
        `[VersionReleaseMapping] removed stale data for release ${releaseTicketId}: ` +
        `ART=${result.artRowsDeleted}, changes=${result.releaseChangesDeleted}, ` +
        `formValues=${result.formValuesDeleted}`,
      );
    }
  }

  private async cleanupStaleVersionReleaseMappings(
    staleMappings: StaleVersionReleaseMapping[],
  ): Promise<{
    artRowsDeleted: number;
    releaseChangesDeleted: number;
    formValuesDeleted: number;
  }> {
    if (staleMappings.length === 0) {
      return { artRowsDeleted: 0, releaseChangesDeleted: 0, formValuesDeleted: 0 };
    }

    return prisma.$transaction(async tx => {
      const mappingsWithDevTicket = staleMappings.filter(
        (
          mapping,
        ): mapping is StaleVersionReleaseMapping & { devTicketXyneId: string } =>
          mapping.devTicketXyneId !== null,
      );

      // A release change belongs to one release, one application sub-ticket,
      // and one dev ticket. All three values are needed to avoid deleting a
      // different ticket's changes from the same release.
      const releaseChanges = mappingsWithDevTicket.length > 0
        ? await tx.releaseChangeType.findMany({
          where: {
            OR: mappingsWithDevTicket.map(mapping => ({
              releaseId: mapping.releaseId,
              applicationReleaseId: mapping.applicationReleaseId,
              devTicketXyneId: mapping.devTicketXyneId,
            })),
          },
          select: { id: true },
        })
        : [];
      const releaseChangeIds = releaseChanges.map(change => change.id);

      let formValuesDeleted = 0;
      let releaseChangesDeleted = 0;
      if (releaseChangeIds.length > 0) {
        // FormEntityValues has no foreign key to ReleaseChangeType. Delete the
        // value bags first so changing a version does not leave orphaned
        // migration or environment data visible on the old release.
        const formValuesResult = await tx.formEntityValues.deleteMany({
          where: {
            entityId: { in: releaseChangeIds },
            entityType: {
              in: [
                FormEntityType.RELEASE_ENV_FORM,
                FormEntityType.RELEASE_MIGRATION_FORM,
              ],
            },
          },
        });
        formValuesDeleted = formValuesResult.count;

        const releaseChangesResult = await tx.releaseChangeType.deleteMany({
          where: { id: { in: releaseChangeIds } },
        });
        releaseChangesDeleted = releaseChangesResult.count;
      }

      // Delete ART rows last. Keep the application SubTicket because other dev
      // tickets may still be mapped through the same application release.
      const artResult = await tx.applicationReleaseTicket.deleteMany({
        where: { id: { in: staleMappings.map(mapping => mapping.artId) } },
      });

      return {
        artRowsDeleted: artResult.count,
        releaseChangesDeleted,
        formValuesDeleted,
      };
    });
  }

  private normalizeVersion(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  async updateDeployedVersionOnCompletion(
    ticketId: string,
    completionTimestamp: Date = new Date(),
  ): Promise<void> {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { board: true },
    });
    if (
      !ticket
      || !ticket.boardId
      || ticket.statusV2 !== TicketStatusV2.COMPLETED
      || !isReleaseTicket(ticket.ticketType as BaseTicketType)
      || ticket.board?.boardType !== BoardType.RELEASE
      || ticket.board.releaseTrackingMode !== ReleaseTrackingMode.VERSION
    ) {
      return;
    }

    // Application boards can carry the same release configuration, so identify
    // the parent board structurally instead of relying on non-null board fields.
    const applicationBoard = await prisma.application.findUnique({
      where: { boardId: ticket.boardId },
      select: { id: true },
    });
    if (applicationBoard) return;

    const releaseVersion = await this.getTicketReleaseVersion(ticket.id);
    if (!releaseVersion) {
      logger.warn(
        `[VersionReleaseMapping] completion skipped for ${ticket.xyneId}: releaseVersion is missing`,
      );
      return;
    }

    const result = await prisma.application.updateMany({
      where: { mainReleaseBoardId: ticket.boardId },
      data: {
        deployedVersion: releaseVersion,
        lastDeployedAt: completionTimestamp,
      },
    });
    logger.info(
      `[VersionReleaseMapping] deployedVersion=${releaseVersion} updated for ${result.count} applications under board ${ticket.boardId}`,
    );
  }
}

export const versionReleaseMappingService = new VersionReleaseMappingService();
