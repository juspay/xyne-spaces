import fetch, { type Response as FetchResponse } from 'node-fetch';
import https from 'https';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';

// Fresh-socket direct agent — mirrors googleSheetsService: the egress proxy in
// some environments prematurely closes reused connections to googleapis, causing
// "socket hang up" (ECONNRESET). keepAlive:false + retries avoid stale sockets.
const driveAgent = new https.Agent({ keepAlive: false });
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

/** Transient network failures worth retrying. */
function isTransient(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'ECONNREFUSED' ||
    code === 'EPIPE' ||
    /socket hang up|network timeout|ECONNRESET/i.test(msg)
  );
}

/** GET with the direct agent, a hard timeout, and retry/backoff on transient errors. */
async function driveFetch(url: string, headers?: Record<string, string>): Promise<FetchResponse> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { method: 'GET', agent: driveAgent, signal: controller.signal, headers });
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt === MAX_RETRIES - 1) break;
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/**
 * Imports files from Google Drive links into a KB collection via the Drive API v3.
 * Every request is authenticated with the user's OAuth access token (drive.readonly,
 * from the "Connect Google Drive" flow), so it reads any file the user can open —
 * public, private, or org-restricted. A token is always required. Bytes are fetched
 * synchronously by the caller and streamed into storage.
 */

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

// Import caps, configurable via DRIVE_IMPORT_MAX_* env (see config/env.ts). Read
// once at module load; defaults preserve the original limits.
/** Per-file hard cap (bytes) for an import. */
export const MAX_FILE_BYTES = config.driveImport.maxFileBytes;
/** Max number of files pulled from a single folder import. */
export const MAX_FILES = config.driveImport.maxFiles;
/** Max total bytes across a folder import. */
export const MAX_TOTAL_BYTES = config.driveImport.maxTotalBytes;
/** Max folder nesting we recurse into. */
export const MAX_DEPTH = config.driveImport.maxDepth;
/** Per-file download timeout. */
const DOWNLOAD_TIMEOUT_MS = 120_000;

/** Google-native mime → OOXML export mime + extension (good for KB text parsing). */
const NATIVE_EXPORT: Record<string, { mimeType: string; ext: string }> = {
  'application/vnd.google-apps.document': {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
  },
  'application/vnd.google-apps.spreadsheet': {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: 'xlsx',
  },
  'application/vnd.google-apps.presentation': {
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ext: 'pptx',
  },
};

const FOLDER_MIME = 'application/vnd.google-apps.folder';

export class DriveNotAccessibleError extends Error {
  constructor(message = 'This Drive link is not publicly accessible. Share it as "Anyone with the link".') {
    super(message);
    this.name = 'DriveNotAccessibleError';
  }
}
/** Thrown when an OAuth Bearer token is rejected (401) — i.e. the user revoked or
 *  the token expired. Signals the caller to clear stored creds and re-prompt. */
export class DriveUnauthorizedError extends Error {
  constructor(message = 'Google Drive access was revoked. Please reconnect Google Drive.') {
    super(message);
    this.name = 'DriveUnauthorizedError';
  }
}
export class DriveRateLimitedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriveRateLimitedError';
  }
}
export class DriveInvalidLinkError extends Error {
  constructor(message = 'Not a valid Google Drive or Docs link.') {
    super(message);
    this.name = 'DriveInvalidLinkError';
  }
}

export interface DriveTarget {
  kind: 'file' | 'folder';
  id: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  /** Directory path (folders only) relative to the imported root; '' at top level. */
  relPath: string;
}

export interface DownloadedFile {
  buffer: Buffer;
  name: string;
  contentType: string;
}

/** Authorization header for a Drive request, using the user's OAuth access token. */
function authHeader(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/**
 * Extract the Drive/Docs target from a user-supplied URL. We only ever use the
 * extracted id against known Google hosts below — the raw URL is never fetched
 * (SSRF-safe).
 */
export function parseDriveTarget(rawUrl: string): DriveTarget {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new DriveInvalidLinkError();
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'drive.google.com' && host !== 'docs.google.com') {
    throw new DriveInvalidLinkError();
  }

  // Folder: /drive/folders/<id> or /drive/u/0/folders/<id>
  const folder = url.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folder?.[1]) return { kind: 'folder', id: folder[1] };

  // Docs/Sheets/Slides/File: /{document|spreadsheets|presentation|file}/d/<id>
  const dPath = url.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (dPath?.[1]) return { kind: 'file', id: dPath[1] };

  // ?id=<id> (open?id=, uc?id=)
  const idParam = url.searchParams.get('id');
  if (idParam) return { kind: 'file', id: idParam };

  throw new DriveInvalidLinkError();
}

async function driveJson<T>(
  path: string,
  params: Record<string, string>,
  accessToken: string,
): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await driveFetch(`${DRIVE_API}${path}?${qs}`, authHeader(accessToken));
  if (res.status === 401) {
    const body = await res.text().catch(() => '');
    logger.warn('[DRIVE_IMPORT] Drive API rejected the access token', { path, status: res.status, body: body.slice(0, 300) });
    throw new DriveUnauthorizedError();
  }
  if (res.status === 403 || res.status === 404) {
    const body = await res.text().catch(() => '');
    logger.warn('[DRIVE_IMPORT] Drive API access denied', { path, status: res.status, body: body.slice(0, 600) });
    throw new DriveNotAccessibleError();
  }
  if (!res.ok) {
    throw new Error(`Drive API ${path} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export async function getMetadata(id: string, accessToken: string): Promise<DriveFile> {
  const meta = await driveJson<{ id: string; name: string; mimeType: string; size?: string }>(
    `/files/${id}`,
    { fields: 'id,name,mimeType,size', supportsAllDrives: 'true' },
    accessToken,
  );
  return {
    id: meta.id,
    name: meta.name,
    mimeType: meta.mimeType,
    size: meta.size ? Number(meta.size) : 0,
    relPath: '',
  };
}

/**
 * Walk a public folder recursively, returning every downloadable (non-folder) file
 * with its directory path. Enforces file-count / total-size / depth caps.
 */
export async function listFolderRecursive(
  folderId: string,
  accessToken: string,
): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let totalBytes = 0;

  const walk = async (id: string, relPath: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) return;
    let pageToken: string | undefined;
    do {
      const params: Record<string, string> = {
        q: `'${id}' in parents and trashed = false`,
        fields: 'nextPageToken,files(id,name,mimeType,size)',
        pageSize: '1000',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      };
      if (pageToken) params.pageToken = pageToken;
      const page = await driveJson<{
        nextPageToken?: string;
        files: Array<{ id: string; name: string; mimeType: string; size?: string }>;
      }>('/files', params, accessToken);

      for (const f of page.files) {
        if (f.mimeType === FOLDER_MIME) {
          await walk(f.id, relPath ? `${relPath}/${f.name}` : f.name, depth + 1);
          continue;
        }
        if (out.length >= MAX_FILES) {
          throw new DriveInvalidLinkError(`Folder has more than ${String(MAX_FILES)} files; import a smaller folder.`);
        }
        const size = f.size ? Number(f.size) : 0;
        totalBytes += size;
        if (totalBytes > MAX_TOTAL_BYTES) {
          throw new DriveInvalidLinkError('Folder exceeds the total size limit for import.');
        }
        out.push({ id: f.id, name: f.name, mimeType: f.mimeType, size, relPath });
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  };

  await walk(folderId, '', 0);
  return out;
}

/**
 * Download a single Drive file into a Buffer. Google-native docs are exported to
 * OOXML; unsupported google-apps types (forms, drawings, …) return null (skip).
 * Enforces MAX_FILE_BYTES and a timeout.
 */
export async function downloadFile(
  file: DriveFile,
  accessToken: string,
): Promise<DownloadedFile | null> {
  const native = NATIVE_EXPORT[file.mimeType];
  const isGoogleApps = file.mimeType.startsWith('application/vnd.google-apps.');
  if (isGoogleApps && !native) {
    logger.info('[DRIVE_IMPORT] Skipping unsupported Google-native file', {
      id: file.id,
      mimeType: file.mimeType,
    });
    return null;
  }

  const url = native
    ? `${DRIVE_API}/files/${file.id}/export?${new URLSearchParams({ mimeType: native.mimeType }).toString()}`
    : `${DRIVE_API}/files/${file.id}?${new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' }).toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', agent: driveAgent, signal: controller.signal, headers: authHeader(accessToken) });
    if (res.status === 401) {
      const body = await res.text().catch(() => '');
      logger.warn('[DRIVE_IMPORT] Download rejected the access token', {
        id: file.id,
        name: file.name,
        status: res.status,
        body: body.slice(0, 300),
      });
      throw new DriveUnauthorizedError();
    }
    if (res.status === 429) {
      throw new DriveRateLimitedError(
        `Google is rate-limiting Drive downloads, so "${file.name}" couldn't be fetched right ` +
          `now. Wait a few minutes and retry.`,
      );
    }
    if (res.status === 403 || res.status === 404) {
      const body = await res.text().catch(() => '');
      logger.warn('[DRIVE_IMPORT] Download denied by Drive', {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        status: res.status,
        body: body.slice(0, 600),
      });
      throw new DriveNotAccessibleError(
        `"${file.name}" could not be downloaded (HTTP ${String(res.status)}). ` +
          `Your connected Google account may not have access to this file.`,
      );
    }
    if (!res.ok) throw new Error(`Drive download failed: ${res.status} ${await res.text()}`);

    const chunks: Buffer[] = [];
    let received = 0;
    for await (const chunk of res.body) {
      const buf = chunk as Buffer;
      received += buf.length;
      if (received > MAX_FILE_BYTES) {
        controller.abort();
        throw new DriveInvalidLinkError(
          `"${file.name}" exceeds the ${String(MAX_FILE_BYTES / (1024 * 1024))} MB per-file limit.`,
        );
      }
      chunks.push(buf);
    }

    const name = native ? `${file.name}.${native.ext}` : file.name;
    const contentType = native ? native.mimeType : file.mimeType || 'application/octet-stream';
    return { buffer: Buffer.concat(chunks), name, contentType };
  } finally {
    clearTimeout(timer);
  }
}
