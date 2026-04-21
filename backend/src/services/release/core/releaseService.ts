import { CommitAnalysisService, CommitAnalysisResult, AnalyzeCommitsRequest } from '@/services/commitAnalysisService';
import { ApplicationRepository } from '@/database/repositories/applicationRepository';
import { TicketRepository } from '@/database/repositories/ticketRepository';
import { logger } from '@/utils/logger';
import {
	buildPRLinksByApplication,
	buildApplicationReleaseTicketMappings,
	filterResultsByApplication
} from '@/services/release/core';
import { formService } from '@/services/formService';
import { ReleaseRepository } from '@/database/repositories/releaseRepository';
import { FormContextType, FormEntityType, ReleaseEventType } from '@xyne/shared';
import { Prisma } from '@prisma/client';

export interface ReleaseContext {
	workspace: string;
	repoSlug: string;
	projectId: string;
	channelId: string;
	conversationId: string;
	userId: string;
	userName: string;
	currentTicketId: string;
	isHotFix?: boolean;
}

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
	private commitAnalysisService: CommitAnalysisService
	private applicationRepository: ApplicationRepository | null = null;
	private ticketRepository: TicketRepository | null = null;
	private releaseRepository: ReleaseRepository | null = null;

	constructor(commitAnalysisService: CommitAnalysisService) {
		this.commitAnalysisService = commitAnalysisService;
		this.initialize();
	}

	private initialize(): void {
		try {
			if (
				this.commitAnalysisService &&
				this.applicationRepository &&
				this.ticketRepository &&
				this.releaseRepository
			) {
				return;
			}

			this.applicationRepository = new ApplicationRepository();
			this.ticketRepository = new TicketRepository();
			this.releaseRepository = new ReleaseRepository();
			logger.info('[ReleaseService] Successfully initialized all repositories');
		} catch (error) {
			logger.error('[ReleaseService] Failed to initialize repositories:', error);
		}
	}


	async release(
		analyzeRequest: AnalyzeCommitsRequest,
		context: ReleaseContext
	): Promise<ReleaseResult> {
		const {
			workspace,
			repoSlug,
			projectId,
			channelId,
			conversationId,
			userId,
			userName,
			currentTicketId,
			isHotFix
		} = context;

		// Step 1: Analyze commits
		logger.info(`[Release] Starting commit analysis for ${workspace}/${repoSlug}`);
		const results = await this.commitAnalysisService.analyzeCommits(analyzeRequest);

		// Collect all file paths
		const allFilePaths = new Set<string>();
		for (const result of results) {
			if (result.filePaths) {
				for (const filePath of result.filePaths) {
					allFilePaths.add(filePath);
				}
			}
		}

		// Step 2: Detect affected applications
		let affectedApplications: AffectedApplicationInfo[] = [];
		let migrationLinks: Array<{ filePath: string; diffUrl: string }> = [];
		let envChanges: Array<{ fileName: string; filePath: string; newValue: string }> = [];

		if (allFilePaths.size > 0) {
			logger.info(`[Release] Detecting affected applications for ${allFilePaths.size} files`);

			const apps = await this.commitAnalysisService.detectAffectedApplications(
				projectId,
				Array.from(allFilePaths)
			);

			if (apps.length > 0) {
				// Step 3: Get ticket info and create sub-tickets
				const ticket = await this.ticketRepository!.getTicketById(currentTicketId);

				if (ticket) {
					const prLinksByApplication = buildPRLinksByApplication(results, apps);

					const subTicketIds = await this.applicationRepository!.createApplicationSubTickets(
						ticket.id,
						ticket.xyneId,
						projectId,
						channelId,
						conversationId,
						userId,
						apps,
						prLinksByApplication,
						isHotFix
					);

					// Build affected applications info
					affectedApplications = apps.map((app, index) => ({
						id: app.id,
						name: app.name,
						subTicketId: subTicketIds[index]?.subTicketId,
						subTicketXyneId: subTicketIds[index]?.xyneId,
						mappedTicketId: subTicketIds[index]?.mappedTicketId,
						matchedFiles: app.matchedFiles,
					}));

					logger.info(`[Release] Created ${subTicketIds.length} sub-tickets`);

					// Step 4: Build application release ticket mappings
					const recordsToCreate = buildApplicationReleaseTicketMappings(
						results,
						affectedApplications,
						apps,
						channelId,
						conversationId
					);

					if (recordsToCreate.length > 0) {
						try {
							await this.applicationRepository!.createApplicationReleaseTicketMappings(recordsToCreate);
							logger.info(`[Release] Created ${recordsToCreate.length} ticket mappings`);
						} catch (error) {
							logger.error('[Release] Failed to create ticket mappings:', error);
						}
					}

					// Step 5: Save release changes per application
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
									userId,
									userName,
									channelId,
									conversationId,
								}
							);

							migrationLinks.push(...result.migrationLinks);
							envChanges.push(...result.envChanges);

							logger.info(
								`[Release] Saved release changes for app ${app.id}: ${result.envChangeCount} env, ${result.migrationChangeCount} migration`
							);
						} catch (error) {
							logger.error(`[Release] Failed to save release changes for app ${app.id}:`, error);
						}
					}
				}
			}
		}

		return {
			results,
			affectedApplications,
			migrationLinks,
			envChanges,
		};
	}

	/**
	 * Update deployed commits for applications
	 */
	async updateDeployedCommits(
		applicationIds: string[],
		newCommitId: string
	): Promise<number> {
		try {
			const updateResult = await this.applicationRepository!.updateDeployedCommit(
				applicationIds,
				newCommitId
			);
			logger.info(
				`[Release] Updated deployedCommit to ${newCommitId} for ${updateResult.count} applications`
			);
			return updateResult.count;
		} catch (error) {
			logger.error('[Release] Failed to update deployedCommit:', error);
			throw error;
		}
	}

	async saveReleaseFormValues(
		releaseChangeTypeId: string,
		payload: Record<string, unknown> | undefined,
		message: string | undefined,
		formValues: Record<string, unknown>,
		formContext: FormContextType,
		formEntity: FormEntityType,
		releaseContext: {
			releaseId: string;
			applicationId: string;
			userId: string;
			userName: string;
			channelId: string;
			conversationId: string;
		}
	): Promise<void> {
		try {
			const form = await formService.findFormByContextAndEntity(formContext, formEntity)

			if (!form) {
				throw new Error(`[XyneReleaseService] No form found for change type ${formEntity}`);
			}
			const formFields = await formService.findFormFields(form?.id);

			if (formFields.length === 0) {
				logger.warn(`[XyneReleaseService] No form fields found for form ${form.id}`);
				return;
			}

			// Build form entity values data
			const formValuesRecord = formValues as Record<string, unknown>;
			const formEntityValuesData = formFields
				.filter((field) => formValuesRecord[field.fieldName] !== undefined)
				.map((field) => ({
					formId: form.id,
					entityId: releaseChangeTypeId,
					entityType: formEntity,
					fieldId: field.id,
					fieldValue: '', // Empty string for backward compatibility
					actualFieldValue: formValuesRecord[field.fieldName] as Prisma.InputJsonValue,
				}));

			if (formEntityValuesData.length > 0) {
				await Promise.all([
					formService.createManyFormEntityValues(formEntityValuesData),
					this.releaseRepository!.createReleaseEvent({
						releaseId: releaseContext.releaseId,
						applicationReleaseId: releaseContext.applicationId,
						eventType: ReleaseEventType.SYSTEM,
						eventName: `FORM_SAVED`,
						message: message ? message : `Saved form values for ${formEntityValuesData.length} fields`,
						userId: releaseContext.userId,
						userName: releaseContext.userName,
						channelId: releaseContext.channelId,
						conversationId: releaseContext.conversationId,
						payload: (payload ? payload : { formValues }) as Prisma.InputJsonValue,
					})
				]);

				logger.info(
					`[XyneReleaseService] Saved ${formEntityValuesData.length} form values for release change ID ${releaseChangeTypeId} (${formEntity})`
				);
			}
		} catch (error) {
			logger.error(`[XyneReleaseService] Error saving form values for release change ID ${releaseChangeTypeId}:`, error);
			throw error;
		}
	}
}
