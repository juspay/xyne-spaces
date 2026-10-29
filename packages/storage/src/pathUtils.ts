import { v4 as uuidv4 } from 'uuid';
import type { UploadOptions } from './types.js';

const WORKSPACE_ID = /^[A-Za-z0-9_-]+$/;

/** Root folder for one workspace's files: workspaces/{workspaceId}/ */
export function workspaceRoot(workspaceId: string): string {
  if (!WORKSPACE_ID.test(workspaceId)) {
    throw new Error(`Invalid workspaceId for a storage path: ${JSON.stringify(workspaceId)}`);
  }
  return `workspaces/${workspaceId}/`;
}

export function generateFilePath(options: UploadOptions): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const timestamp = now.getTime();
  const uuid = uuidv4().split('-')[0];

  const sanitized = sanitizeFilename(options.filename);
  const parts = ['attachments'];

  if (options.scopeType && options.scopeId) {
    parts.push(options.scopeType, options.scopeId);
  }

  parts.push(String(year), month, `${timestamp}-${uuid}-${sanitized}`);
  const filePath = parts.join('/');
  return options.workspaceId ? `${workspaceRoot(options.workspaceId)}${filePath}` : filePath;
}

export function normalizeStoragePath(url: string): string {
  const match = url.match(/^(?:gs|s3|az):\/\/[^/]+\/(.+)$/);
  return match ? match[1] : url;
}

export function sanitizeFilename(filename: string): string {
  if (!filename || filename.trim().length === 0) return 'file';

  const lastDotIndex = filename.lastIndexOf('.');
  const extension = lastDotIndex > 0 ? filename.substring(lastDotIndex).toLowerCase() : '';
  const nameWithoutExtension = lastDotIndex > 0 ? filename.substring(0, lastDotIndex) : filename;

  if (lastDotIndex === 0) return 'file' + filename;

  let sanitized = nameWithoutExtension
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();

  if (!sanitized || sanitized.length === 0) sanitized = 'file';
  if (sanitized.length < 3) sanitized = 'file_' + sanitized.padEnd(3, '0');

  return sanitized + extension;
}
