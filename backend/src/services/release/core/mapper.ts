import { CommitAnalysisResult } from '@/services/commitAnalysisService';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { formatCommitAnalysisMessage } from '@/utils/commitAnalysisMessageFormatter';

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


export function prepareResultsContent(
	results: CommitAnalysisResult[],
	workspace: string,
	repoSlug: string,
	conversationId: string,
	channelId: string | undefined,
	affectedApplications: Array<{
		id: string;
		name: string;
		subTicketId?: string;
		matchedFiles: string[];
	}>,
	currentTicket: { id: string; xyneId: string; conversationId: string | null } | null,
	parentTicket: { xyneId: string | null; conversationId: string | null } | null,
	loadingMessageId: string,
	parentTicketId: string | undefined,
	envChanges: Array<{ filePath: string; fileName: string; newValue: string }>,
	migrationLinks: Array<{ filePath: string; diffUrl: string }>,
	initialMessageId?: string | undefined
): string {
	const isSubTicket = Boolean(parentTicketId && currentTicket);

	return formatCommitAnalysisMessage(
		results,
		workspace,
		repoSlug,
		10000,
		conversationId,
		channelId,
		affectedApplications,
		isSubTicket && currentTicket
			? {
				isSubTicket: true,
				ticketId: currentTicket.id,
				xyneId: currentTicket.xyneId,
				conversationId,
				messageId: loadingMessageId,
				parentTicketId: parentTicketId!,
				parentXyneId: parentTicket?.xyneId || '',
				parentConversationId: parentTicket?.conversationId || '',
				parentMessageId: initialMessageId,
			}
			: undefined,
		envChanges.length > 0 ? envChanges : undefined,
		migrationLinks.length > 0 ? migrationLinks : undefined
	);
}