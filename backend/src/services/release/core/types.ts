// Per-release-event context. Threaded through service calls that need to emit
// release events or scope writes to a specific (release, applicationRelease) pair.
//
// Naming note: distinct from `ReleaseContext` in releaseService.ts, which is the
// top-level *orchestration* context for a full release run. This one is the per-event
// payload (smaller, threaded through commit-analysis and form-save paths).
export interface ReleaseEventContext {
	releaseId: string;
	applicationReleaseId?: string;
	userId: string;
	userName: string;
	channelId: string;
	conversationId: string;
}
