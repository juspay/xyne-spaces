import { workspaceRoot } from '@xyne/storage';
import { config } from '../../config/env';

/**
 * Per-workspace storage layout: with STORAGE_WORKSPACE_PATHS on, new files go
 * under workspaces/{workspaceId}/. Every read uses the path stored on the row,
 * so files in the old layout and the new one work side by side.
 */

/** Upload option for the generated-path uploads (uploadFile / uploadStream). */
export function storageWorkspace(workspaceId: string | null | undefined): { workspaceId?: string } {
  return config.fileStorage.workspacePaths && workspaceId ? { workspaceId } : {};
}

/** A path the caller builds itself, moved under the workspace root when the layout is on. */
export function workspaceStoragePath(workspaceId: string | null | undefined, path: string): string {
  return config.fileStorage.workspacePaths && workspaceId ? `${workspaceRoot(workspaceId)}${path}` : path;
}

/** The workspaces/{workspaceId}/ prefix of a stored path, or '' for a path in the old layout. */
export function workspaceRootOf(path: string): string {
  return /^workspaces\/[A-Za-z0-9_-]+\//.exec(path)?.[0] ?? '';
}

/** True for a generated upload path (uploadFile / uploadStream) in either layout. */
export function isGeneratedUploadPath(path: string): boolean {
  return /^(workspaces\/[A-Za-z0-9_-]+\/)?attachments\//.test(path);
}
