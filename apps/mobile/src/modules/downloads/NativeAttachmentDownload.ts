import { NativeModules, Platform } from 'react-native';

import { isApprovedTransportDestination } from '@/src/utils/mtlsTransportPolicy';

type StartOptions = {
  attachmentId: string;
  url: string;
  destinationPath: string;
  displayName: string;
  mimeType: string;
  headers: Record<string, string>;
};

type DownloadJob = {
  jobId: string;
  attachmentId: string;
  status: string;
};

const Native = NativeModules['LotusAttachmentDownloads'] as
  | {
      startDownload: (options: StartOptions) => Promise<DownloadJob>;
      cancelDownload: (jobId: string) => Promise<boolean>;
      restoreDownloads: () => Promise<boolean>;
      clearDownloads: () => Promise<boolean>;
    }
  | undefined;

export function isPersistentAttachmentDownloadAvailable(): boolean {
  return Platform.OS === 'android' && typeof Native?.startDownload === 'function';
}

export async function startPersistentAttachmentDownload(
  options: StartOptions,
): Promise<DownloadJob> {
  if (!isPersistentAttachmentDownloadAvailable() || !Native?.startDownload) {
    throw new Error('Persistent downloads unavailable. Rebuild the Android app.');
  }
  if (!isApprovedTransportDestination(options.url)) {
    throw new Error('Download destination is not allowed');
  }
  return Native.startDownload(options);
}

export async function restorePersistentDownloads(): Promise<void> {
  await Native?.restoreDownloads?.();
}

export async function clearPersistentDownloads(): Promise<void> {
  await Native?.clearDownloads?.();
}
