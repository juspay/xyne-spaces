import { CommitAnalysisResult } from '@/services/commitAnalysisService';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

export interface ApplicationMappingInput {
	id: string;
	matchedFiles: string[];
}

export interface ApplicationWithSubTicket extends ApplicationMappingInput {
	subTicketId?: string;
}

export interface ApplicationReleaseTicketMapping {
	applicationReleaseId: string;
	ticketId: string;
	title: string;
	ticketUrl: string;
}

/**
 * Builds PR links grouped by application ID
 */
export function buildPRLinksByApplication(
	results: CommitAnalysisResult[],
	affectedApplications: ApplicationMappingInput[]
): Map<string, string[]> {
	const prLinksByApplication = new Map<string, string[]>();

	for (const result of results) {
		if (result.pullRequest && result.filePaths) {
			for (const app of affectedApplications) {
				// Check if any file in this PR affects this application
				const affectsApp = result.filePaths.some(filePath =>
					app.matchedFiles.includes(filePath)
				);

				if (affectsApp) {
					if (!prLinksByApplication.has(app.id)) {
						prLinksByApplication.set(app.id, []);
					}
					prLinksByApplication.get(app.id)!.push(result.pullRequest.url);
				}
			}
		}
	}

	return prLinksByApplication;
}

/**
 * Builds application release ticket mappings
 */
export function buildApplicationReleaseTicketMappings(
	results: CommitAnalysisResult[],
	affectedApplicationsWithSubTickets: ApplicationWithSubTicket[],
	affectedApplications: Array<{ id: string }>,
	channelId: string,
	conversationId: string
): ApplicationReleaseTicketMapping[] {
	const recordsToCreate: ApplicationReleaseTicketMapping[] = [];

	for (const result of results) {
		if (result.ticket && result.filePaths) {
			for (const app of affectedApplicationsWithSubTickets) {
				const affectedApp = affectedApplications.find((a) => a.id === app.id);
				if (affectedApp) {
					const ticketUrl = `${config.slackFrontendUrl}/chat/${channelId}?tab=tickets&ticketId=${result.ticket.id}&conversationId=${conversationId}`;
					recordsToCreate.push({
						applicationReleaseId: app.subTicketId!,
						ticketId: result.ticket.id,
						title: result.ticket.title,
						ticketUrl,
					});
					logger.info(
						`Prepared ApplicationReleaseTicket mapping: ${app.subTicketId} -> ${result.ticket.xyneId}`
					);
				}
			}
		}
	}

	return recordsToCreate;
}

/**
 * Filters commit analysis results to only include files affecting a specific application
 */
export function filterResultsByApplication(
	results: CommitAnalysisResult[],
	matchedFiles: string[]
): CommitAnalysisResult[] {
	return results
		.map(result => ({
			...result,
			filePaths: result.filePaths.filter(fp =>
				matchedFiles.includes(fp)
			),
			fileChanges: result.fileChanges.filter(fc =>
				matchedFiles.includes(fc.path)
			)
		}))
		.filter(r => r.filePaths.length > 0);
}
