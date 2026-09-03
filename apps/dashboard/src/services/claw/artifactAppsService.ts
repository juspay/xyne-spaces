// Saved & published artifact apps, served by claw-auth at
// `/claw/api/v1/artifact-apps`. Goes through `clawRequest` rather than
// `apiInstance` because the rows live in claw-auth's database alongside the chat
// attachment each app is promoted from — there is no Spaces-side record to proxy.

import { clawRequest } from './clawRequest';
import type { ReactArtifactManifest } from '../../components/Chat/XyneAISidebar/utils/XyneAITypes';

const BASE = '/api/v1/artifact-apps';

export type ArtifactAppVisibility = 'PRIVATE' | 'WORKSPACE';

/** Gallery row. Renders from `manifest` alone — no payload fetch. */
export interface ArtifactAppSummary {
  id: string;
  title: string;
  description: string | null;
  visibility: ArtifactAppVisibility;
  ownerUserId: string;
  publishedAt: string | null;
  updatedAt: string;
  manifest: ReactArtifactManifest | null;
}

export interface ArtifactAppVersionSummary {
  id: string;
  versionNumber: number;
  manifest: ReactArtifactManifest;
  sizeBytes: number;
  createdAt: string;
}

/**
 * One recorded restore: head moved backward at a point in time.
 *
 * The move itself is invisible after the fact — `headVersionId` is a pointer, so
 * a restored app looks exactly like one that was always on that version. This is
 * what lets the thread say what happened, and when.
 */
export interface ArtifactAppRestoreEvent {
  id: string;
  versionId: string;
  versionNumber: number;
  fromVersionId: string | null;
  fromVersionNumber: number | null;
  userId: string;
  createdAt: string;
}

export interface ArtifactAppDetail {
  id: string;
  title: string;
  description: string | null;
  visibility: ArtifactAppVisibility;
  ownerUserId: string;
  publishedVersionId: string | null;
  /** The build the owner and the agent are currently on. Moves forward on every
   *  generation and BACKWARD on restore — which is why staleness is measured
   *  against this and not against the highest version number. Null for apps
   *  saved before head tracking. */
  headVersionId: string | null;
  publishedAt: string | null;
  isOwner: boolean;
}

/** Save a chat artifact as a new app. `attachmentId` must belong to the caller. */
export async function saveArtifactApp(input: {
  attachmentId: string;
  title: string;
  description?: string;
}): Promise<{ app: ArtifactAppDetail }> {
  return clawRequest(BASE, { method: 'POST', body: JSON.stringify(input) });
}

/** Append a regenerated build. Byte-identical content is deduped server-side. */
export async function addArtifactAppVersion(
  appId: string,
  attachmentId: string,
): Promise<{ version: ArtifactAppVersionSummary; deduped?: boolean }> {
  return clawRequest(`${BASE}/${encodeURIComponent(appId)}/versions`, {
    method: 'POST',
    body: JSON.stringify({ attachmentId }),
  });
}

/** Pin a version and open it to the workspace. */
export async function publishArtifactApp(
  appId: string,
  versionId: string,
): Promise<{ app: ArtifactAppDetail }> {
  return clawRequest(`${BASE}/${encodeURIComponent(appId)}/publish`, {
    method: 'POST',
    body: JSON.stringify({ versionId }),
  });
}

/**
 * Move HEAD back to an earlier version. A pointer move, not a copy: every
 * version stays in the list, so restoring is reversible — including restoring
 * back to the build you just left.
 *
 * Does not touch the published pin. Head is what the owner and the agent work
 * on; rolling back a draft must not silently republish to the workspace.
 */
export async function restoreArtifactAppVersion(
  appId: string,
  versionId: string,
): Promise<{ app: ArtifactAppDetail; versionId: string; versionNumber: number }> {
  return clawRequest(`${BASE}/${encodeURIComponent(appId)}/restore`, {
    method: 'POST',
    body: JSON.stringify({ versionId }),
  });
}

export async function unpublishArtifactApp(appId: string): Promise<{ app: ArtifactAppDetail }> {
  return clawRequest(`${BASE}/${encodeURIComponent(appId)}/unpublish`, { method: 'POST' });
}

/** `mine` = everything I saved; `workspace` = what others have published. */
export async function listArtifactApps(
  scope: 'mine' | 'workspace',
): Promise<{ apps: ArtifactAppSummary[] }> {
  return clawRequest(`${BASE}?scope=${scope}`);
}

export async function getArtifactApp(appId: string): Promise<{
  app: ArtifactAppDetail;
  versions: ArtifactAppVersionSummary[];
  /** Oldest first. Empty for non-owners — restore history describes drafts they
   *  are not served. */
  restores: ArtifactAppRestoreEvent[];
}> {
  return clawRequest(`${BASE}/${encodeURIComponent(appId)}`);
}

/**
 * URL of the project files for a saved app. Non-owners are always served the
 * pinned version — the server ignores `versionId` for them — so this is safe to
 * call without knowing whether the caller owns the app.
 */
export function artifactAppPayloadUrl(appId: string, versionId?: string): string {
  const q = versionId ? `?versionId=${encodeURIComponent(versionId)}` : '';
  return `${BASE}/${encodeURIComponent(appId)}/payload${q}`;
}
