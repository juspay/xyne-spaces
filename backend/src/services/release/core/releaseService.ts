import { CommitAnalysisService, CommitAnalysisResult, AnalyzeCommitsRequest } from '@/services/commitAnalysisService';
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

export interface ReleaseResult {
	results: CommitAnalysisResult[];
	affectedApplications: AffectedApplicationInfo[];
	migrationLinks: Array<{ filePath: string; diffUrl: string }>;
	envChanges: Array<{ fileName: string; filePath: string; newValue: string }>;
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
		const empty: ReleaseResult = { results: [], affectedApplications: [], migrationLinks: [], envChanges: [] };

		// Step 1: analyze commits
		logger.info(`[Release] Starting commit analysis for ${workspace}/${repoSlug}`);
		const results = await this.commitAnalysisService.analyzeCommits(analyzeRequest);

		const allFilePaths = new Set<string>();
		for (const r of results) {
			if (r.filePaths) for (const p of r.filePaths) allFilePaths.add(p);
		}
		if (allFilePaths.size === 0) {
			logger.warn(`[Release] early return: no file paths in any commit (results=${results.length}) — analysis range may be empty or commits had no file diffs`);
			return { ...empty, results };
		}

		// Step 2: detect affected applications
		logger.info(`[Release] Detecting affected applications for ${allFilePaths.size} files`);
		const apps = await this.commitAnalysisService.detectAffectedApplications(
			mainReleaseBoardId,
			Array.from(allFilePaths),
		);
		if (apps.length === 0) {
			logger.warn(`[Release] early return: no application regex matched any of the ${allFilePaths.size} file paths — check Application.regex configs for mainReleaseBoardId=${mainReleaseBoardId}`);
			return { ...empty, results };
		}

		const ticket = await this.ticketRepository.getTicketById(currentTicketId);
		if (!ticket) {
			logger.warn(`[Release] early return: parent ticket ${currentTicketId} not found via ticketRepository.getTicketById`);
			return { ...empty, results };
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

		// Step 4: ART rows (only for app × dev-ticket pairs the PR actually touched)
		const recordsToCreate = buildApplicationReleaseTicketMappings(results, affectedApplications, currentTicketId);
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

		return { results, affectedApplications, migrationLinks, envChanges };
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
