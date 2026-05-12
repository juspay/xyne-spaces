/**
 * Module-scoped tracker for active attachment uploads.
 *
 * Survives React component mount/unmount cycles (unlike component state),
 * but is NOT persisted across page reloads. This intentional reset-on-reload
 * behavior allows the app to filter out stale PENDING attachments from
 * previous sessions that will never complete.
 */

// Module-level Set to track IDs of attachments currently being uploaded
const _uploadingAttachmentIds = new Set<string>();

/**
 * Add attachment IDs to the tracking set
 */
export function trackUploadingIds(ids: string[]): void {
  ids.forEach(id => _uploadingAttachmentIds.add(id));
}

/**
 * Check if an attachment ID is currently being tracked as uploading
 */
export function isUploadingTracked(id: string): boolean {
  return _uploadingAttachmentIds.has(id);
}

/**
 * Remove attachment IDs from the tracking set (when upload completes or fails)
 */
export function untrackUploadingIds(ids: string[]): void {
  ids.forEach(id => _uploadingAttachmentIds.delete(id));
}

/**
 * Get a snapshot of currently tracked uploading IDs
 */
export function getTrackedUploadingIds(): ReadonlySet<string> {
  return new Set(_uploadingAttachmentIds);
}

/**
 * Clear all tracked IDs
 */
export function clearTrackedUploadingIds(): void {
  _uploadingAttachmentIds.clear();
}
