// Per-release-event context. Threaded through service calls that need to emit
// release events or scope writes to a specific (release, applicationRelease) pair.
export interface ReleaseEventContext {
	releaseId: string;
	applicationReleaseId?: string;
	userId: string;
	userName: string;
	channelId: string;
	conversationId: string;
}
