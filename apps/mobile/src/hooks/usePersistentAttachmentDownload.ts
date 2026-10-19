import { useCallback, useState } from 'react';
import { Alert, PermissionsAndroid, Platform, ToastAndroid } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import { API_BASE_URL } from '@/src/config';
import { buildAuthenticatedHeaders } from '@/src/services/authToken';
import { sanitizeCacheFileName } from '@/src/components/attachments-viewer/utils/file-viewer';
import {
  isPersistentAttachmentDownloadAvailable,
  startPersistentAttachmentDownload,
} from '@/src/modules/downloads/NativeAttachmentDownload';
import { cacheMtlsAttachmentFile } from '@/src/hooks/useMtlsAttachmentFile';
import { shareOrSaveAttachment } from '@/src/components/attachments-viewer/utils/saveAttachment';

export function usePersistentAttachmentDownload() {
  const [isStarting, setIsStarting] = useState(false);

  const download = useCallback(
    async (attachmentId: string, filename?: string | null, mimeType?: string) => {
      if (isStarting) return;
      setIsStarting(true);
      try {
        if (isPersistentAttachmentDownloadAvailable()) {
          if (Number(Platform.Version) >= 33) {
            await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
          }

          const displayName = filename?.trim() || 'attachment';
          const previewPath = `${FileSystem.cacheDirectory}attachments/${attachmentId}-${sanitizeCacheFileName(displayName)}`;
          const previewInfo = await FileSystem.getInfoAsync(previewPath);
          if (previewInfo.exists && 'size' in previewInfo && (previewInfo.size ?? 0) > 0) {
            await shareOrSaveAttachment(
              previewPath,
              filename ?? 'attachment',
              mimeType ?? 'application/octet-stream',
            );
            return;
          }

          const stagingDirectory = `${FileSystem.cacheDirectory}attachment-download-jobs`;
          await FileSystem.makeDirectoryAsync(stagingDirectory, { intermediates: true }).catch(
            () => undefined,
          );
          const destinationPath = `${stagingDirectory}/${attachmentId}-${sanitizeCacheFileName(displayName)}`;
          const headers = await buildAuthenticatedHeaders();

          await startPersistentAttachmentDownload({
            attachmentId,
            url: `${API_BASE_URL}/attachments/${attachmentId}/download`,
            destinationPath,
            displayName,
            mimeType: mimeType || 'application/octet-stream',
            headers,
          });
          ToastAndroid.show('Download started. See notification for progress.', ToastAndroid.SHORT);
          return;
        }

        const cached = await cacheMtlsAttachmentFile(attachmentId, filename);
        await shareOrSaveAttachment(
          cached.uri,
          filename ?? 'attachment',
          mimeType ?? 'application/octet-stream',
        );
      } catch (error) {
        Alert.alert(
          'Download failed',
          error instanceof Error ? error.message : 'Failed to download file.',
        );
      } finally {
        setIsStarting(false);
      }
    },
    [isStarting],
  );

  return { download, isStarting };
}
