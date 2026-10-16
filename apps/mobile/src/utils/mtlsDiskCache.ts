/**
 * Disk-first mTLS downloads for images, thumbnails, emoji, avatars and documents.
 *
 * Native code streams the response to disk and JS only ever holds a file:// URI.
 * Fetching the same file through `mtlsFetch` keeps it in memory three times over —
 * the native bytes, a base64 string, and the copy that crosses the bridge.
 */
import { File, type Directory } from 'expo-file-system';

import { buildAuthenticatedHeaders } from '@/src/services/authToken';
import { mtlsDownloadToFile, type MtlsDownloadResult } from '@/src/utils/mtlsHttpClient';

/**
 * Native streaming cannot run against a local API URL or on an iOS build without
 * mTLS. Those builds fetch through JS instead, which is only safe for small files.
 */
const JS_FALLBACK_MAX_BYTES = 16 * 1024 * 1024;

/** The upload has not finished yet. Worth retrying. */
export class AttachmentNotReadyError extends Error {
  constructor() {
    super('File is still uploading. Please try again in a moment.');
    this.name = 'AttachmentNotReadyError';
  }
}

/** The backend has no thumbnail for this attachment and never will. */
export class ThumbnailUnavailableError extends Error {
  constructor() {
    super('Thumbnail not available for this attachment');
    this.name = 'ThumbnailUnavailableError';
  }
}

export class DownloadFailedError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number) {
    super(`Failed to fetch file: ${statusCode}`);
    this.name = 'DownloadFailedError';
    this.statusCode = statusCode;
  }
}

export const isAttachmentNotReadyError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AttachmentNotReadyError';

export const isThumbnailUnavailableError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'ThumbnailUnavailableError';

/** Retrying cannot help: the attachment, or its thumbnail, does not exist. */
export const isPermanentDownloadMiss = (error: unknown): boolean =>
  isThumbnailUnavailableError(error) ||
  (error instanceof DownloadFailedError && error.statusCode === 404);

function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

async function download(url: string, destinationUri: string): Promise<MtlsDownloadResult> {
  const result = await mtlsDownloadToFile(url, destinationUri, {
    headers: await buildAuthenticatedHeaders(),
    maxJsFallbackBytes: JS_FALLBACK_MAX_BYTES,
  });
  if (result.ok) return result;

  // The backend answers 404 for three different reasons and only the body tells
  // them apart.
  if (result.statusCode === 404) {
    if (result.errorBody.includes('Attachment not yet uploaded')) {
      throw new AttachmentNotReadyError();
    }
    if (result.errorBody.includes('Thumbnail not available')) {
      throw new ThumbnailUnavailableError();
    }
  }
  throw new DownloadFailedError(result.statusCode);
}

/**
 * Removes a cached file that finished downloading after the session that requested it ended,
 * so one account's media is never left behind for the next. Best-effort; never throws.
 */
export function discardCachedFile(uri: string): void {
  try {
    const file = new File(toFileUri(uri));
    if (file.exists) file.delete();
  } catch {
    // Best-effort: sign-out also clears the cache directories.
  }
}

/** Keyed by destination, so two callers wanting the same file share one download. */
const inflight = new Map<string, Promise<string>>();

export type CacheMtlsRemoteFileOptions = {
  url: string;
  /** Where the file is kept, with or without the file:// scheme. */
  localPath: string;
  /**
   * Download even when a file is already there. The existing file stays in place
   * until the new one has fully arrived, so a failed refresh loses nothing.
   */
  refresh?: boolean;
};

/** Returns the file:// URI of `url`, downloading it only if it is not cached. */
export async function cacheMtlsRemoteFile({
  url,
  localPath,
  refresh = false,
}: CacheMtlsRemoteFileOptions): Promise<string> {
  const destination = new File(toFileUri(localPath));
  if (!refresh && destination.exists && destination.size > 0) {
    return destination.uri;
  }

  const key = destination.uri;
  const existing = inflight.get(key);
  if (existing) return existing;

  const work = (async (): Promise<string> => {
    destination.parentDirectory.create({ intermediates: true, idempotent: true });
    const result = await download(url, destination.uri);
    return toFileUri(result.uri ?? destination.uri);
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, work);
  return work;
}

export type CacheMtlsRemoteFileByTypeOptions = {
  url: string;
  directory: Directory;
  /** File name without its extension. */
  baseName: string;
  extensionFor: (mimeType: string | null) => string;
};

/**
 * For files whose extension is only known from the response. Downloads beside the
 * final name and moves into place, so a reader never finds a half-written file.
 */
export async function cacheMtlsRemoteFileByType({
  url,
  directory,
  baseName,
  extensionFor,
}: CacheMtlsRemoteFileByTypeOptions): Promise<{ uri: string; extension: string }> {
  const staging = new File(directory, `.${baseName}.download`);

  try {
    const result = await download(url, staging.uri);
    const extension = extensionFor(result.mimeType);
    const destination = new File(directory, `${baseName}.${extension}`);
    staging.moveSync(destination, { overwrite: true });
    return { uri: destination.uri, extension };
  } catch (error) {
    if (staging.exists) staging.delete();
    throw error;
  }
}
