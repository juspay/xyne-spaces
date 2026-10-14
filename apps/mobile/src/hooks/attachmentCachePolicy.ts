const ATTACHMENT_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const CACHE_NONCE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isSafePathSegment(value: string): boolean {
  return value.length > 0 && value !== '.' && value !== '..';
}

export type AttachmentCacheScope = {
  userId: string;
  workspaceId: string;
  generation: number;
  cacheNonce: string;
};

export type AttachmentResourceKind = 'download' | 'thumbnail' | 'stream';

export function isValidAttachmentId(value: string | null | undefined): value is string {
  return typeof value === 'string' && isSafePathSegment(value) && ATTACHMENT_ID_PATTERN.test(value);
}

export function isValidAttachmentCacheNonce(value: string | null | undefined): value is string {
  return typeof value === 'string' && CACHE_NONCE_PATTERN.test(value);
}

export function createAttachmentCacheScope(
  userId: string | null | undefined,
  workspaceId: string | null | undefined,
  generation: number,
  cacheNonce: string | null | undefined,
): AttachmentCacheScope | null {
  const trimmedUserId = userId?.trim() ?? '';
  const trimmedWorkspaceId = workspaceId?.trim() ?? '';
  if (
    !isSafePathSegment(trimmedUserId) ||
    !isSafePathSegment(trimmedWorkspaceId) ||
    !isValidAttachmentCacheNonce(cacheNonce)
  ) {
    return null;
  }
  if (!Number.isInteger(generation) || generation < 0) {
    return null;
  }
  return {
    userId: trimmedUserId,
    workspaceId: trimmedWorkspaceId,
    generation,
    cacheNonce,
  };
}

export function isSameAttachmentCacheScope(
  left: AttachmentCacheScope | null | undefined,
  right: AttachmentCacheScope | null | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }
  return (
    left.userId === right.userId &&
    left.workspaceId === right.workspaceId &&
    left.generation === right.generation &&
    left.cacheNonce === right.cacheNonce
  );
}

export function encodeCachePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, char => {
    return `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
  });
}

export function buildAttachmentCacheRelativePath(
  scope: AttachmentCacheScope,
  attachmentId: string,
  filename?: string | null,
): string | null {
  if (!isValidAttachmentId(attachmentId)) {
    return null;
  }
  const trimmedFilename = filename?.trim() || 'attachment';
  if (!isSafePathSegment(trimmedFilename)) {
    return null;
  }
  const fileSeg = encodeCachePathSegment(trimmedFilename).slice(0, 80);
  return [
    encodeCachePathSegment(scope.userId),
    encodeCachePathSegment(scope.workspaceId),
    scope.cacheNonce,
    `g${scope.generation}`,
    `${attachmentId}-${fileSeg}`,
  ].join('/');
}

export function buildAttachmentInflightKey(
  scope: AttachmentCacheScope,
  attachmentId: string,
  filename?: string | null,
): string {
  return JSON.stringify([
    scope.cacheNonce,
    scope.generation,
    scope.userId,
    scope.workspaceId,
    attachmentId,
    filename ?? '',
  ]);
}

export function buildAttachmentResourceUrl(
  apiBaseUrl: string,
  attachmentId: string,
  kind: AttachmentResourceKind,
): string {
  if (!isValidAttachmentId(attachmentId)) {
    throw new Error('Invalid attachment id');
  }
  return `${apiBaseUrl}/attachments/${encodeURIComponent(attachmentId)}/${kind}`;
}
