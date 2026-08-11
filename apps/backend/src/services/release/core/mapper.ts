import { CommitAnalysisResult } from '@/services/commitAnalysisService';
import { logger } from '@/utils/logger';
import { isSameCommit } from '@/utils/commitIds';

export interface ApplicationMappingInput {
	id: string;
	matchedFiles: string[];
}

export interface ApplicationWithSubTicket extends ApplicationMappingInput {
	subTicketId?: string;
}

export interface ApplicationReleaseTicketMapping {
	applicationReleaseId: string;
	releaseId: string;
	devTicketId: string;
	// This dev ticket entered the release as a hotfix (merged after the frozen
	// release head). Release-scoped — does not touch the dev ticket's own type.
	isHotfix: boolean;
}

// True if the PR touched any file owned by this application.
function affectsApp(filePaths: string[], matchedFiles: ReadonlySet<string>): boolean {
	for (const fp of filePaths) {
		if (matchedFiles.has(fp)) return true;
	}
	return false;
}

function buildMatchedFileSets<T extends ApplicationMappingInput>(apps: T[]): Map<string, ReadonlySet<string>> {
	return new Map(apps.map(app => [app.id, new Set(app.matchedFiles)]));
}

/**
 * Builds PR links grouped by application ID
 */
export function buildPRLinksByApplication(
	results: CommitAnalysisResult[],
	affectedApplications: ApplicationMappingInput[]
): Map<string, string[]> {
	const matchedFileSets = buildMatchedFileSets(affectedApplications);
	const prLinksByApplication = new Map<string, string[]>();

	for (const result of results) {
		if (!result.pullRequest || !result.filePaths) continue;

		for (const app of affectedApplications) {
			const appFiles = matchedFileSets.get(app.id)!;
			if (!affectsApp(result.filePaths, appFiles)) continue;

			let links = prLinksByApplication.get(app.id);
			if (!links) {
				links = [];
				prLinksByApplication.set(app.id, links);
			}
			links.push(result.pullRequest.url);
		}
	}

	return prLinksByApplication;
}

/**
 * Builds ART (application_release_tickets) row data — one row per
 * (per-app SubTicket × dev-ticket) where the PR for that dev ticket
 * actually touched files belonging to the application.
 *
 * Phase 0b: file-intersection check ensures we don't create rows for
 * (app × dev-ticket) pairs the PR didn't actually touch.
 */
export function buildApplicationReleaseTicketMappings(
	results: CommitAnalysisResult[],
	affectedApplications: ApplicationWithSubTicket[],
	releaseId: string,
	// Present ⇒ this is a hotfix-delta run; every commit NOT in this set is a
	// hotfix (the set holds the boundary/frozen-head commits, which are main PRs).
	// Absent/null ⇒ a normal main run: nothing is a hotfix.
	hotfixBoundaryCommits?: ReadonlySet<string> | null,
): ApplicationReleaseTicketMapping[] {
	const matchedFileSets = buildMatchedFileSets(affectedApplications);
	const recordsToCreate: ApplicationReleaseTicketMapping[] = [];

	for (const result of results) {
		if (!result.ticket || !result.filePaths) continue;

		// prefix compare, not Set.has — boundary ids may be abbreviated SHAs
		const isHotfix =
			hotfixBoundaryCommits != null &&
			![...hotfixBoundaryCommits].some(boundary => isSameCommit(boundary, result.commitId));

		for (const app of affectedApplications) {
			if (!app.subTicketId) continue;
			const appFiles = matchedFileSets.get(app.id)!;
			if (!affectsApp(result.filePaths, appFiles)) continue;

			recordsToCreate.push({
				applicationReleaseId: app.subTicketId,
				releaseId,
				devTicketId: result.ticket.id,
				isHotfix,
			});
			logger.info(
				`Prepared ART row: applicationRelease=${app.subTicketId} → devTicket=${result.ticket.xyneId}${isHotfix ? ' (hotfix)' : ''}`
			);
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
	const matchedSet = new Set(matchedFiles);
	return results
		.map(result => ({
			...result,
			filePaths: result.filePaths.filter(fp => matchedSet.has(fp)),
			fileChanges: result.fileChanges.filter(fc => matchedSet.has(fc.path)),
		}))
		.filter(r => r.filePaths.length > 0);
}
