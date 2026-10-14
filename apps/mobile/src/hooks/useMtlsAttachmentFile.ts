import { useCallback, useEffect, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { v4 as uuidv4 } from 'uuid';

import { API_BASE_URL } from '@/src/config';
import {
  buildAttachmentCacheRelativePath,
  buildAttachmentInflightKey,
  buildAttachmentResourceUrl,
  createAttachmentCacheScope,
  isSameAttachmentCacheScope,
  isValidAttachmentCacheNonce,
  isValidAttachmentId,
  type AttachmentCacheScope,
} from '@/src/hooks/attachmentCachePolicy';
import { cacheMtlsRemoteFile } from '@/src/utils/mtlsDiskCache';
import { deleteKeys, getJson, getString, setJson } from '@/src/services/localStorage';
import { getAuthSessionGeneration } from '@/src/services/authSessionLifecycle';
import { getActiveWorkspaceId } from '@/src/utils/activeWorkspace';

const USER_ID_KEY = '@lotus_user_id';
export const ATTACHMENT_CACHE_NONCE_KEY = '@lotus_attachment_cache_nonce';
const cacheRoot = `${FileSystem.cacheDirectory}attachments`;
const inflightRequests = new Map<string, Promise<{ uri: string }>>();

type AttachmentCacheNonceRecord = {
  userId: string;
  nonce: string;
};

export { AttachmentNotReadyError, isAttachmentNotReadyError } from '@/src/utils/mtlsDiskCache';

type UseMtlsAttachmentFileResult = {
  uri: string | null;
  text: string | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
};

export class AttachmentSessionUnavailableError extends Error {
  constructor() {
    super('Attachment download requires an active session.');
    this.name = 'AttachmentSessionUnavailableError';
  }
}

function readStoredCacheNonce(userId: string): string | null {
  const stored = getJson<AttachmentCacheNonceRecord>(ATTACHMENT_CACHE_NONCE_KEY);
  if (!stored || stored.userId !== userId || !isValidAttachmentCacheNonce(stored.nonce)) {
    return null;
  }
  return stored.nonce;
}

function resolveAttachmentCacheNonce(userId: string): string {
  const existing = readStoredCacheNonce(userId);
  if (existing) {
    return existing;
  }
  const nonce = uuidv4();
  setJson(ATTACHMENT_CACHE_NONCE_KEY, { userId, nonce });
  return nonce;
}

function resolveAttachmentCacheScope(): AttachmentCacheScope | null {
  const userId = getString(USER_ID_KEY);
  const workspaceId = getActiveWorkspaceId();
  if (!userId?.trim() || !workspaceId?.trim()) {
    return null;
  }
  return createAttachmentCacheScope(
    userId,
    workspaceId,
    getAuthSessionGeneration(),
    resolveAttachmentCacheNonce(userId.trim()),
  );
}

async function ensureDirectory(path: string): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(path);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(path, { intermediates: true });
  }
}

async function deleteCachedFile(path: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(path, { idempotent: true });
  } catch {
    // Best-effort: a leftover file must not keep a stale session alive.
  }
}

export async function clearMtlsAttachmentCache(): Promise<void> {
  inflightRequests.clear();
  deleteKeys([ATTACHMENT_CACHE_NONCE_KEY]);
  try {
    await FileSystem.deleteAsync(cacheRoot, { idempotent: true });
  } catch {
    // Best-effort directory retirement; the next download recreates the tree.
  }
}

function buildLocalPath(
  scope: AttachmentCacheScope,
  attachmentId: string,
  filename?: string | null,
): string | null {
  const relativePath = buildAttachmentCacheRelativePath(scope, attachmentId, filename);
  if (!relativePath) {
    return null;
  }
  return `${cacheRoot}/${relativePath}`;
}

async function downloadMtlsAttachmentFile(
  scope: AttachmentCacheScope,
  attachmentId: string,
  filename?: string | null,
): Promise<{ uri: string }> {
  if (!isValidAttachmentId(attachmentId)) {
    throw new Error('Invalid attachment id');
  }

  const localPath = buildLocalPath(scope, attachmentId, filename);
  if (!localPath) {
    throw new Error('Invalid attachment id');
  }
  const directory = localPath.slice(0, localPath.lastIndexOf('/'));
  await ensureDirectory(directory);

  if (!isSameAttachmentCacheScope(scope, resolveAttachmentCacheScope())) {
    throw new AttachmentSessionUnavailableError();
  }

  // Shared disk cache: reuses an existing file, de-duplicates concurrent downloads and
  // maps the backend's 404 bodies to AttachmentNotReadyError / DownloadFailedError.
  const url = buildAttachmentResourceUrl(API_BASE_URL, attachmentId, 'download');
  const resultUri = await cacheMtlsRemoteFile({ url, localPath });

  if (!isSameAttachmentCacheScope(scope, resolveAttachmentCacheScope())) {
    await deleteCachedFile(resultUri);
    if (resultUri !== localPath) {
      await deleteCachedFile(localPath);
    }
    throw new AttachmentSessionUnavailableError();
  }

  return { uri: resultUri };
}

export const cacheMtlsAttachmentFile = async (
  attachmentId: string,
  filename?: string | null,
): Promise<{ uri: string }> => {
  if (!isValidAttachmentId(attachmentId)) {
    throw new Error('Invalid attachment id');
  }

  const storedNonce = getJson<AttachmentCacheNonceRecord>(ATTACHMENT_CACHE_NONCE_KEY);
  const currentUserId = getString(USER_ID_KEY)?.trim() ?? '';
  if (storedNonce && storedNonce.userId !== currentUserId) {
    await clearMtlsAttachmentCache();
  }

  const scope = resolveAttachmentCacheScope();
  if (!scope) {
    throw new AttachmentSessionUnavailableError();
  }

  const requestKey = buildAttachmentInflightKey(scope, attachmentId, filename);
  const existingRequest = inflightRequests.get(requestKey);
  if (existingRequest) {
    return existingRequest;
  }

  const request = downloadMtlsAttachmentFile(scope, attachmentId, filename).finally(() => {
    inflightRequests.delete(requestKey);
  });
  inflightRequests.set(requestKey, request);
  return request;
};

export function useMtlsAttachmentFile(
  attachmentId: string | undefined,
  filename?: string | null,
  options: { readText?: boolean } = {},
): UseMtlsAttachmentFileResult {
  const requestIdRef = useRef(0);
  const [state, setState] = useState<{
    uri: string | null;
    text: string | null;
    isLoading: boolean;
    error: Error | null;
  }>({
    uri: null,
    text: null,
    isLoading: !!attachmentId,
    error: null,
  });

  const fetchFile = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const startedGeneration = getAuthSessionGeneration();

    if (!attachmentId) {
      if (requestId === requestIdRef.current) {
        setState({ uri: null, text: null, isLoading: false, error: null });
      }
      return;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const { uri } = await cacheMtlsAttachmentFile(attachmentId, filename);
      if (requestId !== requestIdRef.current) {
        return;
      }
      if (getAuthSessionGeneration() !== startedGeneration) {
        return;
      }

      const text = options.readText ? await FileSystem.readAsStringAsync(uri) : null;
      if (requestId !== requestIdRef.current) {
        return;
      }
      if (getAuthSessionGeneration() !== startedGeneration) {
        return;
      }

      setState({ uri, text, isLoading: false, error: null });
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      if (getAuthSessionGeneration() !== startedGeneration) {
        return;
      }
      setState({
        uri: null,
        text: null,
        isLoading: false,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }, [attachmentId, filename, options.readText]);

  useEffect(() => {
    void fetchFile();
    return () => {
      requestIdRef.current += 1;
    };
  }, [fetchFile]);

  return {
    uri: state.uri,
    text: state.text,
    isLoading: state.isLoading,
    error: state.error,
    refetch: fetchFile,
  };
}
