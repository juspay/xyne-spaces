import { CommitAnalysisService, CommitAnalysisResult, AnalyzeCommitsRequest, countDistinctMigrationFiles } from '@/services/commitAnalysisService';
import { ApplicationRepository } from '@/database/repositories/applicationRepository';
import { TicketRepository } from '@/database/repositories/ticketRepository';
import { logger } from '@/utils/logger';
import {
	buildPRLinksByApplication,
	buildApplicationReleaseTicketMappings,
	filterResultsByApplication,
} from '@/services/release/core';
import { ReleaseRepository } from '@/database/repositories/releaseRepository';
import { ReleaseEventType } from '@xyne/shared';
import { Prisma } from '@prisma/client';

// Top-level orchestration context for a full release run. Distinct from
// `ReleaseEventContext` in ./types.ts (per-event payload threaded through
// commit-analysis and form-save paths).
export interface ReleaseContext {
	workspace: string;
	repoSlug: string;
	projectId: string;
	mainReleaseBoardId: string;
	channelId: string;
	conversationId: string;
	userId: string;
	userName: string;
	currentTicketId: string;
	isHotFix?: boolean;
}

// subTicketId/mappedTicketId/subTicketXyneId are optional: an app may be
// affected (its files changed) but fail SubTicket provisioning. Such apps still
// flow through env/migration capture with no applicationReleaseId; only ART-row
// creation requires a real subTicketId.
export interface AffectedApplicationInfo {
	id: string;
	name: string;
	subTicketId?: string;
	subTicketXyneId?: string;
	mappedTicketId?: string;
	matchedFiles: string[];
}

/** Per-app diagnostic surfaced in the release summary message so the user can
 * distinguish "no env/migrations changed" from "my regex was broken". One row
 * per configured application — including zero-match apps. */
export interface ApplicationMatchSummaryRow {
	name: string;
	regex: string;
	matchCount: number;
	regexValid: boolean;
}

export interface ReleaseResult {
	results: CommitAnalysisResult[];
	affectedApplications: AffectedApplicationInfo[];
	migrationLinks: Array<{ filePath: string; diffUrl: string }>;
	envChanges: Array<{ fileName: string; filePath: string; newValue: string; commitId?: string }>;
	/** Empty when commit range has no file changes; otherwise one row per app. */
	appMatchSummary: ApplicationMatchSummaryRow[];
}

export class ReleaseService {
	private commitAnalysisService: CommitAnalysisService;
	private applicationRepository: ApplicationRepository;
	private ticketRepository: TicketRepository;
	private releaseRepository: ReleaseRepository;

	constructor(commitAnalysisService: CommitAnalysisService) {
		this.commitAnalysisService = commitAnalysisService;
		this.applicationRepository = new ApplicationRepository();
		this.ticketRepository = new TicketRepository();
		this.releaseRepository = new ReleaseRepository();
	}

	async release(
		analyzeRequest: AnalyzeCommitsRequest,
		context: ReleaseContext
	): Promise<ReleaseResult> {
		const {
			workspace,
			repoSlug,
			projectId,
			mainReleaseBoardId,
			channelId,
			conversationId,
			userId,
			userName,
			currentTicketId,
			isHotFix,
		} = context;
		const empty: ReleaseResult = {
			results: [],
			affectedApplications: [],
			migrationLinks: [],
			envChanges: [],
			appMatchSummary: [],
		};

		// Best-effort timeline event. Wrapped so a failure here never breaks the
		// release flow (the event log is observability, not a hard dependency).
		const emitEvent = (
			eventType: ReleaseEventType,
			eventName: string,
			message: string,
			applicationReleaseId?: string,
			payload?: Prisma.InputJsonValue,
		): void => {
			void this.releaseRepository
				.createReleaseEvent({
					releaseId: currentTicketId,
					applicationReleaseId,
					eventType,
					eventName,
					message,
					userId,
					userName,
					channelId,
					conversationId,
					payload,
				})
				.catch(err =>
					logger.warn(
						`[Release] failed to emit ${eventType}/${eventName} event: ${err instanceof Error ? err.message : String(err)}`,
					),
				);
		};

		// AnalyzeCommitsRequest is a union (commit-range vs version-mode). Probe
		// the discriminator to build a useful start message either way.
		const rangeLabel =
			'deployedCommitId' in analyzeRequest && 'newCommitId' in analyzeRequest
				? ` (${analyzeRequest.deployedCommitId.slice(0, 8)} → ${analyzeRequest.newCommitId.slice(0, 8)})`
				: '';
		emitEvent(
			ReleaseEventType.RELEASE,
			'COMMIT_ANALYSIS_STARTED',
			`Commit analysis started for ${workspace}/${repoSlug}${rangeLabel}`,
		);

		// Step 1: analyze commits
		logger.info(`[Release] Starting commit analysis for ${workspace}/${repoSlug}`);
		const results = await this.commitAnalysisService.analyzeCommits(analyzeRequest);

		const allFilePaths = new Set<string>();
		for (const r of results) {
			if (r.filePaths) for (const p of r.filePaths) allFilePaths.add(p);
		}
		if (allFilePaths.size === 0) {
			logger.warn(`[Release] early return: no file paths in any commit (results=${results.length}) — analysis range may be empty or commits had no file diffs`);
			emitEvent(
				ReleaseEventType.RELEASE,
				'COMMIT_ANALYSIS_COMPLETED',
				`No file changes in this commit range — nothing to deploy`,
			);
			return { ...empty, results };
		}

		// Compute per-app diagnostic up-front so it's included in both the
		// 0-apps-matched early return and the happy-path result.
		const appMatchSummary = await this.commitAnalysisService.getApplicationMatchSummary(
			mainReleaseBoardId,
			Array.from(allFilePaths),
		);

		// Step 2: detect affected applications
		logger.info(`[Release] Detecting affected applications for ${allFilePaths.size} files`);
		const apps = await this.commitAnalysisService.detectAffectedApplications(
			mainReleaseBoardId,
			Array.from(allFilePaths),
		);
		if (apps.length === 0) {
			logger.warn(`[Release] early return: no application regex matched any of the ${allFilePaths.size} file paths — check Application.regex configs for mainReleaseBoardId=${mainReleaseBoardId}`);
			emitEvent(
				ReleaseEventType.RELEASE,
				'COMMIT_ANALYSIS_COMPLETED',
				`No application regex matched any of the ${allFilePaths.size} changed files — check the Application config`,
			);
			return { ...empty, results, appMatchSummary };
		}

		const ticket = await this.ticketRepository.getTicketById(currentTicketId);
		if (!ticket) {
			logger.warn(`[Release] early return: parent ticket ${currentTicketId} not found via ticketRepository.getTicketById`);
			return { ...empty, results, appMatchSummary };
		}

		// Step 3: provision per-app SubTickets/Tickets
		const prLinksByApplication = buildPRLinksByApplication(results, apps);
		const perAppByAppId = await this.applicationRepository.createApplicationSubTickets({
			parentTicketId: ticket.id,
			parentTitle: ticket.title,
			projectId,
			channelId,
			conversationId,
			createdBy: userId,
			affectedApplications: apps,
			prLinksByApplication,
			isHotFix,
		});

		// Emit one SUBTICKET event per successfully-provisioned application.
		for (const app of apps) {
			const perApp = perAppByAppId.get(app.id);
			if (perApp) {
				emitEvent(
					ReleaseEventType.SUBTICKET,
					'SUBTICKET_PROVISIONED',
					`Prepared ${app.name} (${app.matchedFiles.length} file${app.matchedFiles.length === 1 ? '' : 's'} matched)`,
					perApp.subTicketId,
					{ applicationId: app.id, applicationName: app.name } as Prisma.InputJsonValue,
				);
			}
		}

		// Keep EVERY affected app. Apps whose SubTicket provisioning failed have no
		// perApp entry — they still capture env/migration changes (with a null
		// applicationReleaseId); they just can't get ART rows (which need a real
		// SubTicket id — buildApplicationReleaseTicketMappings skips them).
		const affectedApplications: AffectedApplicationInfo[] = apps.map(app => {
			const perApp = perAppByAppId.get(app.id);
			return {
				id: app.id,
				name: app.name,
				subTicketId: perApp?.subTicketId,
				subTicketXyneId: perApp?.xyneId,
				mappedTicketId: perApp?.mappedTicketId,
				matchedFiles: app.matchedFiles,
			};
		});

		const provisionedCount = affectedApplications.filter(a => a.subTicketId).length;
		logger.info(`[Release] Provisioned ${provisionedCount} of ${apps.length} affected applications`);

		// Step 4: ART rows (only for app × dev-ticket pairs the PR actually touched).
		// On a hotfix delta run, every non-boundary dev ticket is flagged isHotfix
		// (the boundary = the frozen release head, a main PR). Release-scoped: the
		// dev ticket's own type stays untouched.
		const hotfixBoundaryCommits =
			isHotFix && 'deployedCommitId' in analyzeRequest
				? new Set(
						analyzeRequest.deployedCommitId
							.split(',')
							.map(c => c.trim())
							.filter(Boolean),
					)
				: null;
		const recordsToCreate = buildApplicationReleaseTicketMappings(
			results,
			affectedApplications,
			currentTicketId,
			hotfixBoundaryCommits,
		);
		if (recordsToCreate.length > 0) {
			try {
				const createResult = await this.applicationRepository.createApplicationReleaseTicketMappings(recordsToCreate);
				logger.info(
					`[Release] ART rows persisted: attempted=${recordsToCreate.length}, inserted=${createResult.count}, releaseId=${currentTicketId}`,
				);
			} catch (error) {
				// ART rows are not best-effort: a release with missing
				// application_release_tickets is incomplete, so surface the failure
				// as a SYSTEM event and then abort before Step 5 instead of returning
				// a "successful" result with missing testing cells.
				await this.emitMappingWriteFailedEvent(error as Error, recordsToCreate.length, currentTicketId, channelId, conversationId);
				throw error;
			}
		}

		// Step 5: per-app release-change capture
		const migrationLinks: ReleaseResult['migrationLinks'] = [];
		const envChanges: ReleaseResult['envChanges'] = [];
		for (const app of affectedApplications) {
			try {
				const filteredResults = filterResultsByApplication(results, app.matchedFiles);
				if (filteredResults.length === 0) continue;

				const result = await this.commitAnalysisService.saveReleaseChangesFromAnalysis(
					workspace,
					repoSlug,
					filteredResults,
					app.id,
					{
						releaseId: currentTicketId,
						applicationReleaseId: app.subTicketId,
						userId,
						userName,
						channelId,
						conversationId,
					},
				);

				migrationLinks.push(...result.migrationLinks);
				envChanges.push(...result.envChanges);
				logger.info(
					`[Release] Saved release changes for app ${app.id}: ${result.envChangeCount} env, ${result.migrationChangeCount} migration`,
				);
			} catch (error) {
				logger.error(`[Release] Failed to save release changes for app ${app.id}:`, error);
			}
		}

		// Render the summary from ALL persisted release changes for this release (the
		// source of truth the tabs/report read), not just the rows saved this run. The
		// dedup guard skips re-inserting changes that already exist, so the run-accumulated
		// arrays under-report on re-run; reading persisted facts makes analysis idempotent.
		// Falls back to the run-accumulated arrays if the authoritative read fails.
		let summaryMigrationLinks = migrationLinks;
		let summaryEnvChanges = envChanges;
		try {
			const authoritative = await this.commitAnalysisService.buildReleaseChangeSummary(
				workspace,
				repoSlug,
				currentTicketId,
				mainReleaseBoardId,
			);
			summaryMigrationLinks = authoritative.migrationLinks;
			summaryEnvChanges = authoritative.envChanges;
		} catch (error) {
			logger.error(
				`[Release] Failed to build authoritative change summary for ${currentTicketId}, using run-accumulated:`,
				error,
			);
		}

		const migrationFileCount = countDistinctMigrationFiles(summaryMigrationLinks);
		emitEvent(
			ReleaseEventType.RELEASE,
			'COMMIT_ANALYSIS_COMPLETED',
			`Analysis complete: ${affectedApplications.length} app${affectedApplications.length === 1 ? '' : 's'} affected, ${summaryEnvChanges.length} env change${summaryEnvChanges.length === 1 ? '' : 's'}, ${migrationFileCount} migration${migrationFileCount === 1 ? '' : 's'}`,
			undefined,
			{
				affectedAppCount: affectedApplications.length,
				envChangeCount: summaryEnvChanges.length,
				migrationCount: migrationFileCount,
			} as Prisma.InputJsonValue,
		);

		return { results, affectedApplications, migrationLinks: summaryMigrationLinks, envChanges: summaryEnvChanges, appMatchSummary };
	}

	// Surface ART-write failures as a SYSTEM release event so they aren't only in logs.
	private async emitMappingWriteFailedEvent(
		error: Error,
		recordCount: number,
		releaseId: string,
		channelId: string,
		conversationId: string,
	): Promise<void> {
		logger.error('[Release] Failed to create ART rows:', error);
		try {
			await this.releaseRepository.createReleaseEvent({
				releaseId,
				eventType: ReleaseEventType.SYSTEM,
				eventName: 'MAPPING_WRITE_FAILED',
				message: `Failed to create ${recordCount} ART rows: ${error.message}`,
				channelId,
				conversationId,
				payload: {
					recordCount,
					errorMessage: error.message,
				} as Prisma.InputJsonValue,
			});
		} catch (eventError) {
			logger.error('[Release] Also failed to emit MAPPING_WRITE_FAILED event:', eventError);
		}
	}

	async updateDeployedCommits(applicationIds: string[], newCommitId: string): Promise<number> {
		try {
			const updateResult = await this.applicationRepository.updateDeployedCommit(applicationIds, newCommitId);
			logger.info(`[Release] Updated deployedCommit to ${newCommitId} for ${updateResult.count} applications`);
			return updateResult.count;
		} catch (error) {
			logger.error('[Release] Failed to update deployedCommit:', error);
			throw error;
		}
	}

}
