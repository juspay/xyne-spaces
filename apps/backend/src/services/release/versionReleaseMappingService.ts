import { Application, Prisma, PullRequests } from '@prisma/client';
import { ApplicationRepository } from '@/database/repositories/applicationRepository';
import { DatabaseClient } from '@/database/client';
import { BitbucketManager } from '@/git-providers/bitbucket/apis';
import { BitbucketService } from '@/services/bitbucketService';
import { CommitAnalysisService, PullRequestDiffFile } from '@/services/commitAnalysisService';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { parseBitbucketRepoUrl } from '@/utils/repoUrlParser';
import { BitbucketConfig } from '@/types/bitbucket';
import {
  BaseTicketType,
  BoardType,
  FormEntityType,
  ReleaseTrackingMode,
  isReleaseTicket,
} from '@xyne/shared';

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
  private readonly bitbucketManager = new BitbucketManager();
  private readonly commitAnalysisService = new CommitAnalysisService(
    new BitbucketService(buildBitbucketServiceConfig()),
  );

  // Serializes syncs per ticket: rapid successive releaseVersion edits used to
  // run concurrently and interleave SubTicket/ART writes. Each queued run
  // re-reads the current version, so the latest edit always wins.
  private readonly pendingSyncs = new Map<string, Promise<void>>();

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
    for (const devTicket of devTickets) {
      await this.mapDevTicketToRelease(devTicket, releaseTicket);
    }
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

    const releases = await this.findReleaseTicketsByVersion(devTicket.projectId, releaseVersion);
    for (const releaseTicket of releases) {
      await this.mapDevTicketToRelease(devTicket, releaseTicket);
    }
  }

  private async mapDevTicketToRelease(
    devTicket: TicketWithReleaseBoard,
    releaseTicket: TicketWithReleaseBoard,
  ): Promise<void> {
    if (
      !releaseTicket.boardId
      || releaseTicket.board?.releaseTrackingMode !== ReleaseTrackingMode.VERSION
    ) {
      return;
    }

    const pullRequests = await prisma.pullRequests.findMany({
      where: {
        ticketId: devTicket.id,
        status: { not: 'DELETED' },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (pullRequests.length === 0) {
      logger.info(`[VersionReleaseMapping] skipped ${devTicket.xyneId}: no linked PR rows`);
      return;
    }

    const { affectedApps, prLinksByApplication, prDiffContexts } = await this.detectAffectedApplicationsFromPRs(
      releaseTicket.boardId,
      pullRequests,
    );
    if (affectedApps.length === 0) {
      logger.info(`[VersionReleaseMapping] skipped ${devTicket.xyneId}: no affected applications from PR diffs`);
      return;
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
      return;
    }

    const result = await this.applicationRepository.createApplicationReleaseTicketMappings(records);
    logger.info(
      `[VersionReleaseMapping] mapped dev ticket ${devTicket.xyneId} to release ${releaseTicket.xyneId}: ` +
      `attempted=${records.length}, inserted=${result.count}`,
    );

    await this.saveReleaseChangesForAffectedApps(
      releaseTicket,
      devTicket,
      affectedApps,
      perAppSubTickets,
      prDiffContexts,
    );
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
    const parsed = parseBitbucketRepoUrl(pr.repositoryUrl);
    if (!parsed) {
      logger.warn(`[VersionReleaseMapping] skipped PR ${pr.prUrl}: cannot parse repositoryUrl=${pr.repositoryUrl}`);
      return null;
    }

    try {
      const diffFiles = await this.bitbucketManager.getPRDiff(parsed.projectKey, parsed.repoSlug, pr.prId);
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
    perAppSubTickets: Map<string, { subTicketId: string; mappedTicketId: string; xyneId: string }>,
    prDiffContexts: PullRequestDiffContext[],
  ): Promise<void> {
    const userName = await this.getReleaseEventUserName(releaseTicket.createdBy);

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
      || ticket.statusV2 !== 'COMPLETED'
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
